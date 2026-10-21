import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import {
  generateWorld, buildMesh, buildDistantSlopeLOD, filters, makeAtlas, TILE_ID, ATLAS, TREE, fbm, smoothstep, hash3, riverZ, V,
} from './world.js';
import { Ambience } from './audio.js';
import { initHut } from './hut.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const params = new URLSearchParams(location.search);
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const isTouch = matchMedia('(pointer: coarse)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (params.get('ui') === '0') document.body.classList.add('no-ui');

const seasonByMonth = (m) => (m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter');
const state = {
  season: SEASONS.includes(params.get('season')) ? params.get('season') : seasonByMonth(new Date().getMonth()),
  rain: params.get('weather') === 'rain',
  realtime: !params.has('hour'),
  hour: params.has('hour') ? clamp(parseFloat(params.get('hour')) || 0, 0, 24) : 12,
};

// ---------- 渲染器 ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('#loading').textContent = '你的浏览器暂时不支持 WebGL，看不到这个小世界。';
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.75 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// 电影感色调映射：高光不再直接削平；Neutral 比 ACES 更能守住这种插画色的饱和度
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.16;
$('#app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe0f5, 40, 160);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.3, 1200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-2, 4, -3.15);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 14;
controls.maxDistance = 52;
controls.minPolarAngle = 0.2;
controls.maxPolarAngle = 1.42;
controls.rotateSpeed = isTouch ? 0.7 : 0.55;
controls.autoRotate = !reduceMotion && params.get('rotate') !== '0';
controls.autoRotateSpeed = 0.35;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.addEventListener('start', () => { controls.autoRotate = false; hideHint(); });

function fitCamera() {
  const a = innerWidth / innerHeight;
  camera.aspect = a;
  camera.fov = a < 0.8 ? 60 : a < 1.2 ? 53 : 46;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
{
  const a = innerWidth / innerHeight;
  // V3.2 的入口镜头以小屋、枣树为双核心：手机视角稍收紧，
  // 对准两者中间偏后的庭院，背景林木仅构成边框而非占据前景。
  // ?framing=classic 可对照上一版手机取景，桌面原视角不变。
  const portraitTouch = isTouch && a < 0.8;
  const heroFrame = portraitTouch && params.get('framing') !== 'classic';
  if (portraitTouch) controls.target.set(heroFrame ? -2.1 : -2, 3, heroFrame ? -4.3 : -2);
  const dist = portraitTouch ? (heroFrame ? 41.5 : 44) : a < 0.8 ? 37 : 33;
  const az = heroFrame ? 0.59 : 0.62, pol = portraitTouch ? 1.18 : 1.34;
  camera.position.set(
    controls.target.x + dist * Math.sin(pol) * Math.sin(az),
    controls.target.y + dist * Math.cos(pol),
    controls.target.z + dist * Math.sin(pol) * Math.cos(az),
  );
  fitCamera();
}
addEventListener('resize', fitCamera);

// ---------- 光照 ----------
const hemi = new THREE.HemisphereLight(0xbfe0f5, 0x6b5a44, 1);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0x3a4a7a, 0);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 1, far: 320 });
sun.shadow.bias = -0.0016;
sun.shadow.normalBias = 0.14;
scene.add(sun, sun.target);
const SHADOW_CENTER = new THREE.Vector3(-1, 0, -2);
sun.target.position.copy(SHADOW_CENTER);

// ---------- 世界 ----------
const atlas = makeAtlas();
const tileTexture = (tile) => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS.TILE;
  cv.getContext('2d').drawImage(atlas.image, tile * ATLAS.SLOT + ATLAS.PAD, ATLAS.PAD, ATLAS.TILE, ATLAS.TILE, 0, 0, ATLAS.TILE, ATLAS.TILE);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
};
const blockMat = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true });

const W = generateWorld();
// Isolated preview A/B switch for measured LOD-vs-original comparisons.
// ?lod=off reconstructs the original terrain geometry without touching W.grid.
const useDistantLOD = params.get('lod') !== 'off';
const world = buildMesh(W.grid, filters.world, [0,0,0], useDistantLOD);
const worldMesh = new THREE.Mesh(world.geometry, blockMat);
worldMesh.castShadow = worldMesh.receiveShadow = true;
// 网格按细分倍数缩小回世界尺度：方块更细，世界范围不变
worldMesh.scale.setScalar(1 / V);
scene.add(worldMesh);
const distantSlope = useDistantLOD ? buildDistantSlopeLOD(W) : null;
if (distantSlope) {
  const distantSlopeMesh = new THREE.Mesh(distantSlope.geometry,
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  distantSlopeMesh.receiveShadow = true;
  distantSlopeMesh.castShadow = false;
  scene.add(distantSlopeMesh);
}

// 水面：单独的半透明材质，纹理滚动表现水流
const waterTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const g = cv.getContext('2d');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = 200 + Math.floor(hash3(x, y, 3) * 40) + ((x + y * 3) % 11 === 0 ? 30 : 0);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
const water = buildMesh(W.grid, filters.water);
{
  // 水面自己铺 UV：图集的 UV 是「格子内的小区间」，直接乘会被压成一条窄带
  const uv = water.geometry.attributes.uv.array;
  const rep = 16 / V;
  for (let i = 0; i < uv.length; i += 2) {
    const m = i % 8;
    uv[i] = (m === 2 || m === 4) ? rep : 0;
    uv[i + 1] = (m === 4 || m === 6) ? 1 : 0;
  }
}
const waterMat = new THREE.MeshPhongMaterial({ map: waterTex, color: 0x3d93cf, transparent: true, opacity: 0.82, shininess: 70, specular: 0x9fd0ff });
const waterMesh = new THREE.Mesh(water.geometry, waterMat);
waterMesh.receiveShadow = true;
waterMesh.renderOrder = 1;
waterMesh.scale.setScalar(1 / V);
scene.add(waterMesh);

// ---------- 枣树（可摇） ----------
const pivot = [TREE.x, 0.5, TREE.z];
const pivotBlock = [TREE.x * V, 0.5 * V, TREE.z * V];
const treeGroup = new THREE.Group();
treeGroup.position.set(...pivot);
treeGroup.scale.setScalar(1 / V);
scene.add(treeGroup);
const trunk = buildMesh(W.grid, filters.trunk, pivotBlock);
const leaves = buildMesh(W.grid, filters.leaves, pivotBlock);
const trunkMesh = new THREE.Mesh(trunk.geometry, blockMat);
const leavesMesh = new THREE.Mesh(leaves.geometry, blockMat);
for (const m of [trunkMesh, leavesMesh]) { m.castShadow = m.receiveShadow = true; treeGroup.add(m); }

const dummy = new THREE.Object3D();
const fruitGeo = new THREE.BoxGeometry(0.34 * V, 0.42 * V, 0.34 * V);
const fruitMat = new THREE.MeshLambertMaterial();
const fruitMesh = new THREE.InstancedMesh(fruitGeo, fruitMat, W.fruitSpots.length);
fruitMesh.castShadow = true;
treeGroup.add(fruitMesh);
const fruitAlive = W.fruitSpots.map(() => true);
// 树组整体缩了 1/V，组内坐标要用小方块单位
const inTree = (s) => [(s.x - pivot[0]) * V, (s.y - pivot[1]) * V, (s.z - pivot[2]) * V];
function setFruit(i, on) {
  const s = W.fruitSpots[i];
  dummy.position.set(...inTree(s));
  dummy.rotation.set(0, s.v * 3, 0);
  dummy.scale.setScalar(on ? 1 : 0.0001);
  dummy.updateMatrix();
  fruitMesh.setMatrixAt(i, dummy.matrix);
  fruitMesh.instanceMatrix.needsUpdate = true;
  fruitAlive[i] = on;
}
W.fruitSpots.forEach((_, i) => setFruit(i, true));

const blossomMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22 * V, 0.22 * V, 0.22 * V), new THREE.MeshLambertMaterial(), W.flowerSpots.length);
W.flowerSpots.forEach((s, i) => {
  const p = inTree(s);
  dummy.position.set(p[0], p[1] + 0.15 * V, p[2]);
  dummy.rotation.set(s.v, s.v * 2, 0);
  dummy.scale.setScalar(1);
  dummy.updateMatrix();
  blossomMesh.setMatrixAt(i, dummy.matrix);
  blossomMesh.setColorAt(i, new THREE.Color(s.v < 0.5 ? '#f5e27a' : '#fff6c9'));
});
treeGroup.add(blossomMesh);

// ---------- 茅草屋的门、窗、灯 ----------
const windowTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#5a3d25';
  g.fillRect(0, 0, 16, 2); g.fillRect(0, 14, 16, 2); g.fillRect(0, 0, 2, 16); g.fillRect(14, 0, 2, 16);
  g.fillRect(7, 0, 2, 16); g.fillRect(0, 7, 16, 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
})();
const windowMat = new THREE.MeshBasicMaterial({ map: windowTex, color: 0xa8d4e6 });
for (const w of W.windows) {
  const ws = W.windowWidth;
  const geo = w.axis === 'z' ? new THREE.BoxGeometry(ws, ws, 0.14) : new THREE.BoxGeometry(0.14, ws, ws);
  const m = new THREE.Mesh(geo, windowMat);
  m.position.set(w.x, w.y, w.z);
  scene.add(m);
  // V3.2 四扇窗共用同尺寸的立体木框；前墙左右两窗镜像一致。
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x69523b });
  const face = w.axis === 'z';
  const thickness = 0.105, depth = 0.18, he = ws / 2;
  const frame = new THREE.Group();
  frame.position.set(w.x, w.y, w.z);
  for(const edge of [-he,he]){
    const vertical = new THREE.Mesh(
      new THREE.BoxGeometry(face?thickness:depth, ws + 0.12, face?depth:thickness), frameMat);
    if(face)vertical.position.x=edge;
    else vertical.position.z=edge;
    frame.add(vertical);
    const horizontal = new THREE.Mesh(
      new THREE.BoxGeometry(face?ws + 0.12:depth, thickness, face?depth:ws + 0.12), frameMat);
    horizontal.position.y=edge;
    frame.add(horizontal);
  }
  scene.add(frame);
}

const plankTex = tileTexture(TILE_ID.PLANK);
const doorPivot = new THREE.Group();
doorPivot.position.set(W.door.x - W.door.width / 2, 1.5, W.door.z + 0.1);
const door = new THREE.Mesh(new THREE.BoxGeometry(W.door.width, 2, 0.16), new THREE.MeshLambertMaterial({ map: plankTex, color: 0x9a6a40 }));
door.position.x = W.door.width / 2;
door.castShadow = true;
const knob = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: 0xe0b85a }));
knob.position.set(W.door.width * 0.33, -0.05, 0.12);
door.add(knob);
doorPivot.add(door);
scene.add(doorPivot);

// V3.2 门前成对壁灯：几何上镜像，门板与窗框都以入口中心线为基准。
const lanternMat = new THREE.MeshBasicMaterial({ color: 0x8a7a5a });
const lanternBracketMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1a });
for(const side of [-1,1]){
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.30,0.39,0.30),lanternMat);
  lantern.position.set(W.door.x + side*1.20, 2.28, W.door.z + 0.72);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.09,0.09,0.36),lanternBracketMat);
  bracket.position.set(0,0.29,-0.19);
  lantern.add(bracket);
  scene.add(lantern);
}
const porchLight = new THREE.PointLight(0xffc46b, 0, 22, 1.6);
porchLight.position.set(W.door.x, 2.6, W.door.z + 2);
scene.add(porchLight);

// ---------- 小桥 V3.1：紧凑木拱桥，连续扶手与两侧承重梁 ----------
// 所有部件沿 deckY 的切线倾斜，避免弧形桥被画成一排松散水平短棍。
// 仅在桥侧增加梁，中央桥下仍给纸船的桅杆留出净空。
{
  const b = W.bridge;
  const mat = new THREE.MeshLambertMaterial({ map: plankTex, color: 0xb98c5c });
  const cols = Math.round(b.x1 - b.x0), rows = Math.round(b.z1 - b.z0);
  const rowsAll = rows + 2;
  const zc = (b.z0 + b.z1) / 2;
  const zAt = (j) => zc + (j - (rowsAll - 1) / 2);
  const deckY = (j) => 0.3 + 1.12 * Math.sin(Math.PI * (j / (rowsAll - 1)));
  const slopeAt = (j) => {
    const before = Math.max(0, j - 1), after = Math.min(rowsAll - 1, j + 1);
    return Math.atan2(deckY(after) - deckY(before), zAt(after) - zAt(before));
  };
  // 原板深 0.92、中心间距 1，会露出明显纵向缝隙；改为小幅交叠的贴合板。
  // 木板随拱线调整坡度，仍留横向细纹而不是做成整块塑料平台。
  const planks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.985, 0.24, 1.035), mat, cols * rowsAll);
  let n = 0;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rowsAll; j++) {
    dummy.position.set(b.x0 + 0.5 + i, deckY(j), zAt(j));
    dummy.rotation.set(-slopeAt(j), 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    planks.setMatrixAt(n++, dummy.matrix);
  }
  planks.castShadow = planks.receiveShadow = true;
  scene.add(planks);

  const woodMat = new THREE.MeshLambertMaterial({
    map: tileTexture(TILE_ID.LOG), color: 0x775337,
  });
  const RAIL_H = 0.82;
  const spans = rowsAll - 1;
  // 一根梁沿多段拱线首尾重叠，视觉上是一条完整的木结构。
  const sideBeams = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.19, 0.23, 1), woodMat, 2 * spans);
  const handrails = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.14, 0.14, 1), woodMat, 2 * spans);
  let railIndex = 0;
  const posts = [];
  for (let side = 0; side < 2; side++) {
    const xRail = side === 0 ? b.x0 - 0.055 : b.x1 + 0.055;
    const xBeam = side === 0 ? b.x0 + 0.075 : b.x1 - 0.075;
    for (let j = 0; j < spans; j++) {
      const y0 = deckY(j), y1 = deckY(j + 1);
      const z0 = zAt(j), z1 = zAt(j + 1);
      const slope = Math.atan2(y1 - y0, z1 - z0);
      const len = Math.hypot(y1 - y0, z1 - z0);
      dummy.rotation.set(-slope, 0, 0);
      dummy.scale.set(1, 1, len * 1.045);
      dummy.position.set(xRail, (y0 + y1) / 2 + RAIL_H, (z0 + z1) / 2);
      dummy.updateMatrix();
      handrails.setMatrixAt(railIndex, dummy.matrix);
      dummy.position.set(xBeam, (y0 + y1) / 2 - 0.17, (z0 + z1) / 2);
      dummy.updateMatrix();
      sideBeams.setMatrixAt(railIndex, dummy.matrix);
      railIndex++;
    }
    // 两侧每两格一根立柱，并确保桥首尾都有支点。
    for (let j = 0; j < rowsAll; j++) {
      if (j % 2 === 0 || j === rowsAll - 1) posts.push([xRail, deckY(j), zAt(j)]);
    }
  }
  sideBeams.castShadow = handrails.castShadow = true;
  scene.add(sideBeams, handrails);

  // 立柱下端只入桥板，旧实现从每根立柱延伸到固定水位，像河里散乱的木桩。
  const balusters = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.15, 1, 0.15), woodMat, posts.length);
  posts.forEach(([x, y, z], i) => {
    const bottom = y - 0.12, top = y + RAIL_H + 0.09;
    dummy.position.set(x, (bottom + top) / 2, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, top - bottom, 1);
    dummy.updateMatrix();
    balusters.setMatrixAt(i, dummy.matrix);
  });
  balusters.castShadow = true;
  scene.add(balusters);
}



// ---------- 风车叶片：缓慢转，给远景一点活气 ----------
let sailGroup = null;
if (W.windmill) {
  const { hub } = W.windmill;
  sailGroup = new THREE.Group();
  sailGroup.position.set(hub.x, hub.y, hub.z);
  sailGroup.rotation.y = -0.5;
  const beamMat = new THREE.MeshLambertMaterial({ color: 0x7a5c42 });
  const clothMat = new THREE.MeshLambertMaterial({ color: 0xe4d6b6 });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * Math.PI * 2;
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.9, 0.09), beamMat);
    spine.position.y = 1.45;
    arm.add(spine);
    for (let k = 0; k < 3; k++) {
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.04), clothMat);
      cloth.position.set(0.37, 1.0 + k * 0.72, 0);
      arm.add(cloth);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.05), beamMat);
      bar.position.set(0.36, 1.32 + k * 0.72, 0);
      arm.add(bar);
    }
    sailGroup.add(arm);
  }
  scene.add(sailGroup);
}

// ---------- 门外的小物件：信箱、路牌、纸船 ----------
const groundY = (x, z) => Math.max(0, W.getH(Math.round(x), Math.round(z))) + 0.5 / V;
const lamb = (color, map = null) => new THREE.MeshLambertMaterial({ color, map });
function block(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}
const logTex = tileTexture(TILE_ID.LOG);
const hitBox = (w, h, d, kind) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  m.visible = false;
  m.userData.kind = kind;
  return m;
};

// 信箱放在院门步道外侧，随屋前庭院一起后移，而不是留在原屋门位置。
const MAILBOX = { x: W.yard.x - 2.35, z: W.yard.z + 0.95 };
const mailbox = new THREE.Group();
mailbox.position.set(MAILBOX.x, groundY(MAILBOX.x, MAILBOX.z), MAILBOX.z);
block(0.18, 1.15, 0.18, lamb(0x6b4a2e, logTex), 0, 0.58, 0, mailbox);
block(0.58, 0.46, 0.82, lamb(0xb8302a), 0, 1.36, 0, mailbox);
block(0.62, 0.12, 0.86, lamb(0x8f1e18), 0, 1.64, 0, mailbox);
block(0.04, 0.26, 0.34, lamb(0x3a1a12), 0.3, 1.34, 0, mailbox);
const mailFlag = block(0.06, 0.36, 0.1, lamb(0xffd36b), 0.32, 1.52, 0.32, mailbox);
const mailHit = hitBox(1.5, 2.4, 1.7, 'mail');
mailHit.position.y = 1.1;
mailbox.add(mailHit);
scene.add(mailbox);

function signTexture(text) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.drawImage(plankTex.image, 0, 0, 256, 64);
  g.fillStyle = 'rgba(160, 110, 60, 0.55)';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#3a2412';
  g.font = 'bold 34px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const SIGN = { x: -11.8, z: 6.4 };
const signpost = new THREE.Group();
signpost.position.set(SIGN.x, groundY(SIGN.x, SIGN.z), SIGN.z);
block(0.2, 2.5, 0.2, lamb(0x6b4a2e, logTex), 0, 1.25, 0, signpost);
const board1 = block(1.7, 0.42, 0.1, new THREE.MeshLambertMaterial({ map: signTexture('作品 →') }), 0.4, 2.1, 0.12, signpost);
board1.rotation.y = 0.5;
const board2 = block(1.7, 0.42, 0.1, new THREE.MeshLambertMaterial({ map: signTexture('← 小屋') }), -0.3, 1.55, 0.12, signpost);
board2.rotation.y = -0.35;
const signHit = hitBox(2.6, 3, 1.6, 'sign');
signHit.position.y = 1.5;
signpost.add(signHit);
scene.add(signpost);

const boat = new THREE.Group();
const paper = lamb(0xf7f3e8);
block(1.0, 0.14, 0.42, paper, 0, 0, 0, boat);
block(0.7, 0.14, 0.3, paper, 0, -0.1, 0, boat);
block(0.16, 0.12, 0.42, paper, 0.56, 0.1, 0, boat);
block(0.16, 0.12, 0.42, paper, -0.56, 0.1, 0, boat);
block(0.5, 0.36, 0.06, paper, 0, 0.24, 0, boat);
block(0.22, 0.16, 0.07, lamb(0xd8cdb4), 0, 0.5, 0, boat);
const boatHit = hitBox(2.4, 1.8, 2.4, 'boat');
boat.add(boatHit);
scene.add(boat);
const BOAT_X0 = -24, BOAT_X1 = 22;
let boatX = -12;

// ---------- 小花与芦苇 ----------
const flowerOrder = W.groundFlowers;
const stemMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), new THREE.MeshLambertMaterial({ color: 0x4f8a32 }), flowerOrder.length);
const petalMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.2, 0.24), new THREE.MeshLambertMaterial(), flowerOrder.length);
flowerOrder.forEach((f, i) => {
  dummy.rotation.set(0, f.v * 6, 0);
  dummy.scale.set(1, f.s, 1);
  dummy.position.set(f.x, 0.5 + 0.15 * f.s, f.z);
  dummy.updateMatrix();
  stemMesh.setMatrixAt(i, dummy.matrix);
  dummy.scale.setScalar(1);
  dummy.position.set(f.x, 0.5 + 0.3 * f.s + 0.08, f.z);
  dummy.updateMatrix();
  petalMesh.setMatrixAt(i, dummy.matrix);
});
scene.add(stemMesh, petalMesh);

// ---------- V3.1 轻薄渐尖草叶：不再用厚盒状模型 ----------
const GROUND_Y = 0.5 / V;
const TUFT_COLORS = {
  spring: ['#83a977', '#a3be8c', '#729b7b', '#b4be84'],
  summer: ['#658c62', '#819b75', '#527d65', '#9ca779'],
  autumn: ['#a19658', '#aea36c', '#8f8b57', '#b0a277'],
  winter: ['#ced5cc', '#bfcac1', '#d8ddd1', '#bdc5bd'],
};
const grassGeo = new THREE.BufferGeometry();
grassGeo.setAttribute('position', new THREE.Float32BufferAttribute([
  -0.045,0,0,   0.045,0,0,
  -0.035,0.12,0.01,  0.035,0.12,0.01,
  -0.017,0.27,0.048, 0.014,0.27,0.048,
  0,0.34,0.065,
], 3));
grassGeo.setIndex([0,1,2, 1,3,2, 2,3,4, 3,5,4, 4,5,6]);
grassGeo.computeVertexNormals();
const TUFT_N = W.tufts.length;
const BLADES_MAX = 4;
const tuftMesh = new THREE.InstancedMesh(grassGeo,
  new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), Math.max(1, TUFT_N * BLADES_MAX));
tuftMesh.frustumCulled = false;
tuftMesh.castShadow = false;
scene.add(tuftMesh);
const tuftSeeds = [];
W.tufts.forEach((t) => {
  for (let k = 0; k < t.n; k++) {
    const j = tuftSeeds.length;
    const a = t.rot + k * (Math.PI * 2 / t.n) + (t.v - 0.5) * 0.15;
    const height = (0.18 + 0.14 * ((t.v * 3.31 + k * 0.47) % 1)) * t.s;
    dummy.position.set(t.x + Math.cos(a) * 0.075, GROUND_Y - 0.013,
      t.z + Math.sin(a) * 0.075);
    dummy.rotation.set(Math.sin(a) * 0.2, a, -Math.cos(a) * 0.2);
    dummy.scale.set(0.74 + 0.2 * t.v, height / 0.34, 1);
    dummy.updateMatrix();
    tuftMesh.setMatrixAt(j, dummy.matrix);
    tuftSeeds.push((t.v + k * 0.29) % 1);
  }
});
const TUFT_INSTANCE_COUNT = tuftSeeds.length;
tuftMesh.count = TUFT_INSTANCE_COUNT;
tuftMesh.instanceMatrix.needsUpdate = true;

const lilyMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), new THREE.MeshLambertMaterial({ color: 0x5f9440 }), Math.max(1, W.lilies.length));
W.lilies.forEach((l, i) => {
  dummy.position.set(l.x, 0.14, l.z);
  dummy.rotation.set(0, l.rot, 0);
  dummy.scale.set(l.s, 1, l.s);
  dummy.updateMatrix();
  lilyMesh.setMatrixAt(i, dummy.matrix);
});
lilyMesh.count = W.lilies.length;
lilyMesh.castShadow = false;
scene.add(lilyMesh);



const reedMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.065, 1, 0.032), new THREE.MeshLambertMaterial(), W.reeds.length);
const cattailMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.125, 0.28, 0.125), new THREE.MeshLambertMaterial({ color: 0x7a5232 }), W.reeds.length);
W.reeds.forEach((r, i) => {
  const lean = 0.1 + r.r * 0.5;
  dummy.rotation.set(Math.sin(r.a) * lean, r.a, -Math.cos(r.a) * lean);
  dummy.scale.set(1, r.h, 1);
  dummy.position.set(r.x, GROUND_Y + r.h * 0.5, r.z);
  dummy.updateMatrix();
  reedMesh.setMatrixAt(i, dummy.matrix);
  // 香蒲棒：跟着倾斜方向偏出去一点，别全都笔直朝天
  dummy.position.set(
    r.x + Math.cos(r.a) * Math.sin(lean) * r.h * 0.9,
    GROUND_Y + r.h * Math.cos(lean) * 0.94,
    r.z + Math.sin(r.a) * Math.sin(lean) * r.h * 0.9,
  );
  dummy.updateMatrix();
  cattailMesh.setMatrixAt(i, dummy.matrix);
});
cattailMesh.count = Math.round(W.reeds.length * 0.33);
reedMesh.castShadow = true;
scene.add(reedMesh, cattailMesh);

// ---------- V3.1 坡地独立布景：低矮灌木团和散石 ----------
const HILL_SHRUB_COLORS = {
  spring: ['#829f76', '#9bae80', '#71977b', '#a9b78c'],
  summer: ['#648966', '#7b9670', '#557c69', '#909f71'],
  autumn: ['#a89563', '#b59b72', '#8a9364', '#b4a16d'],
  winter: ['#9cabb0', '#aeb8b2', '#b8b5a3', '#859998'],
};
const HILL_N = W.hillShrubs.length;
const hillShrubMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.46, 0.27, 0.43),
  new THREE.MeshLambertMaterial(), Math.max(1, HILL_N * 2));
hillShrubMesh.castShadow = false;
hillShrubMesh.receiveShadow = true;
hillShrubMesh.frustumCulled = false;
W.hillShrubs.forEach((p, i) => {
  for (let k = 0; k < 2; k++) {
    const offset = (k === 0 ? -0.13 : 0.17) * p.size;
    dummy.position.set(p.x + Math.sin(p.rot) * offset,
      p.y + (k === 0 ? 0.14 : 0.22) * p.size,
      p.z + Math.cos(p.rot) * offset);
    dummy.rotation.set(0, p.rot + k * 0.9, 0);
    dummy.scale.set(p.size * (k ? 0.67 : 1), p.size * (k ? 0.74 : 1), p.size * (k ? 0.7 : 1));
    dummy.updateMatrix();
    hillShrubMesh.setMatrixAt(i * 2 + k, dummy.matrix);
  }
});
hillShrubMesh.count = HILL_N * 2;
hillShrubMesh.instanceMatrix.needsUpdate = true;
scene.add(hillShrubMesh);
const stoneMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.18, 0.35),
  new THREE.MeshLambertMaterial(), Math.max(1, W.hillStones.length));
const STONE_TINT = ['#9e9b8d', '#b3ab97', '#919c95', '#ada391'];
W.hillStones.forEach((p, i) => {
  dummy.position.set(p.x, p.y + 0.055 * p.size, p.z);
  dummy.rotation.set(0, p.rot, 0);
  dummy.scale.set(p.size, 0.75 + p.v * 0.6, p.size * (0.8 + p.v * 0.35));
  dummy.updateMatrix();
  stoneMesh.setMatrixAt(i, dummy.matrix);
  stoneMesh.setColorAt(i, new THREE.Color(STONE_TINT[Math.floor(p.v * STONE_TINT.length)]));
});
stoneMesh.count = W.hillStones.length;
stoneMesh.frustumCulled = false;
stoneMesh.castShadow = false;
stoneMesh.instanceMatrix.needsUpdate = true;
scene.add(stoneMesh);

// ---------- 萤火：夜里的草坡上慢慢飘 ----------
const FIRE_N = 44;
const fireMat = new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const fireMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.085, 0.085, 0.085), fireMat, FIRE_N);
fireMesh.frustumCulled = false;
scene.add(fireMesh);
const fireSeeds = Array.from({ length: FIRE_N }, () => ({
  ax: (Math.random() * 2 - 1) * 9 + 1,
  az: (Math.random() * 2 - 1) * 7 - 1,
  y: 0.7 + Math.random() * 2.4,
  sp: 0.25 + Math.random() * 0.5,
  ph: Math.random() * Math.PI * 2,
  rr: 0.6 + Math.random() * 1.6,
}));
let fireT = 0;


// ---------- 蝴蝶：白天在草坡的花丛间飘 ----------
const BFLY_N = 10;
const bflyMat = new THREE.MeshLambertMaterial({ vertexColors: false, transparent: true, opacity: 0 });
const bflyMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.05, 0.24), bflyMat, BFLY_N);
bflyMesh.frustumCulled = false;
scene.add(bflyMesh);
const BFLY_COLORS = ['#f6c453', '#f08b6a', '#e8e0f4', '#8fd0e8'];
const bflySeeds = Array.from({ length: BFLY_N }, () => {
  const f = flowerOrder[Math.floor(Math.random() * flowerOrder.length)] || { x: 0, z: 0 };
  return {
    x: f.x + (Math.random() - 0.5) * 3,
    z: f.z + (Math.random() - 0.5) * 3,
    y: 0.9 + Math.random() * 1.1,
    r: 0.9 + Math.random() * 1.4,
    sp: 0.35 + Math.random() * 0.5,
    ph: Math.random() * 6.28,
  };
});
for (let i = 0; i < BFLY_N; i++) bflyMesh.setColorAt(i, new THREE.Color(BFLY_COLORS[i % BFLY_COLORS.length]));
if (bflyMesh.instanceColor) bflyMesh.instanceColor.needsUpdate = true;
let bflyT = 0;

// ---------- 炊烟 ----------
const smoke = [];
for (let i = 0; i < 8; i++) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xdddddd, transparent: true, depthWrite: false }));
  scene.add(m);
  smoke.push(m);
}

// ---------- 天空：渐变穹顶、方块太阳和月亮、星星 ----------
const skyGroup = new THREE.Group();
scene.add(skyGroup);
const glowTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.22, 'rgba(255,246,220,0.5)');
  grd.addColorStop(0.55, 'rgba(255,236,200,0.15)');
  grd.addColorStop(1, 'rgba(255,232,190,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const skyUniforms = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(600, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP;\nvoid main() {\n  float h = clamp(vP.y * 5.2, 0.0, 1.0);\n  gl_FragColor = vec4(mix(bottom, top, pow(h, 0.62)), 1.0);\n  #include <tonemapping_fragment>\n  #include <colorspace_fragment>\n}',
    side: THREE.BackSide, depthWrite: false, fog: false,
  }),
);
skyDome.renderOrder = -10;
skyGroup.add(skyDome);
const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), new THREE.MeshBasicMaterial({ color: 0xfff0b0, fog: false, transparent: true, depthWrite: false }));
const moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ color: 0xe8eef8, fog: false, transparent: true, depthWrite: false }));
skyGroup.add(sunMesh, moonMesh);
// 日月光晕：给天空一点层次，别只是一块渐变色
const sunGlow = new THREE.Mesh(new THREE.PlaneGeometry(190, 190), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
const moonGlow = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, color: 0xcfe0ff, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
skyGroup.add(sunGlow, moonGlow);
const starGeo = new THREE.BufferGeometry();
{
  const p = [];
  for (let i = 0; i < 800; i++) {
    const u = Math.random() * Math.PI * 2, v = Math.acos(Math.random() * 0.95);
    p.push(Math.sin(v) * Math.cos(u) * 560, Math.cos(v) * 560, Math.sin(v) * Math.sin(u) * 560);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
}
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false });
skyGroup.add(new THREE.Points(starGeo, starMat));

// ---------- 远景山脊：世界外圈的三层剪影 ----------
// 高度场只有 56 的半径，真山放进来就会把画面堵死；远山改成「布景」，
// 用几层几乎不做明暗的剪影，颜色跟着地平线走，等于把空气透视直接画出来。
const rangeLayers = [];
{
  const build = (radius, hMax, seed, harm) => {
    const SEG = 240;
    const pos = [], col = [], idx = [];
    const nAt = (a) => {
      const c = Math.cos(a), s = Math.sin(a);
      return fbm(c * 1.9 + seed, s * 1.9 - seed) * 0.6
        + fbm(c * 4.7 - seed, s * 4.7 + seed) * 0.3
        + fbm(c * 10.5 + seed, s * 10.5 - seed) * 0.1;
    };
    // 环形采样：二尺度的鞍部 + 单峰的尖顶，才有连绵起伏的味道
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const n = nAt(a);
      const peak = Math.pow(Math.max(0, n - 0.34) / 0.66, 1.6);
      const h = hMax * (0.18 + peak * 0.82) * harm;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      pos.push(x, h, z, x, -40, z);
      // 山脚更淡（空气厚），山脊稍微沉一点
      const cTop = 0.83 + n * 0.1, cBot = 1.04;
      col.push(cTop, cTop, cTop, cBot, cBot, cBot);
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = -5;
    scene.add(mesh);
    return m;
  };
  // 越远越淡、越高：三层拉开就是纵深
  rangeLayers.push(
    { mat: build(118, 19, 3.1, 1), tint: new THREE.Color('#6f88ad'), k: 0.82 },
    { mat: build(166, 29, 11.7, 1), tint: new THREE.Color('#8298bb'), k: 0.6 },
    { mat: build(230, 40, 23.4, 1), tint: new THREE.Color('#9babca'), k: 0.4 },
  );
}

// ---------- 方块云 ----------
const CELL = 8, CN = 60;
const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
const cloudMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cloudMat, CN * CN);
const cloudGroup = new THREE.Group();
cloudGroup.add(cloudMesh);
scene.add(cloudGroup);
let cloudShift = 0;
function buildClouds() {
  const thr = state.rain ? 0.44 : 0.62;
  let n = 0;
  for (let i = 0; i < CN; i++) for (let j = 0; j < CN; j++) {
    const v = fbm((i + cloudShift) * 0.17, j * 0.17 + 40);
    if (v < thr) continue;
    dummy.position.set((i - CN / 2) * CELL, 62, (j - CN / 2) * CELL);
    dummy.rotation.set(0, 0, 0);
    const puff = 0.55 + ((v - thr) / (1 - thr)) * 0.9;
    dummy.scale.set(CELL * puff, (2.2 + (v - thr) * 7) * (0.7 + puff * 0.5), CELL * puff);
    dummy.updateMatrix();
    cloudMesh.setMatrixAt(n++, dummy.matrix);
  }
  cloudMesh.count = n;
  cloudMesh.instanceMatrix.needsUpdate = true;
}

// ---------- 雨和雪 ----------
const RAIN_N = 2200, AREA = 46, TOPY = 48;
const rainPos = new Float32Array(RAIN_N * 6);
const rainSpeed = new Float32Array(RAIN_N);
for (let i = 0; i < RAIN_N; i++) {
  const x = (Math.random() * 2 - 1) * AREA, z = (Math.random() * 2 - 1) * AREA, y = Math.random() * TOPY;
  rainPos.set([x, y, z, x, y + 0.9, z], i * 6);
  rainSpeed[i] = 38 + Math.random() * 12;
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: 0xb9cde0, transparent: true, opacity: 0.55 });
const rain = new THREE.LineSegments(rainGeo, rainMat);
rain.frustumCulled = false;
scene.add(rain);

const SNOW_N = 2400;
const snowPos = new Float32Array(SNOW_N * 3);
const snowPhase = new Float32Array(SNOW_N);
for (let i = 0; i < SNOW_N; i++) {
  snowPos.set([(Math.random() * 2 - 1) * AREA, Math.random() * TOPY, (Math.random() * 2 - 1) * AREA], i * 3);
  snowPhase[i] = Math.random() * 10;
}
const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, transparent: true, opacity: 0.95, depthWrite: false });
const snow = new THREE.Points(snowGeo, snowMat);
snow.frustumCulled = false;
scene.add(snow);

// ---------- 萤火虫 ----------
const FF_N = 70;
const ffBase = [];
const ffPos = new Float32Array(FF_N * 3), ffCol = new Float32Array(FF_N * 3);
for (let i = 0; i < FF_N; i++) {
  const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 16;
  ffBase.push({ x: Math.cos(a) * r - 1, y: 0.9 + Math.random() * 2.4, z: Math.sin(a) * r, p: Math.random() * 10, s: 0.5 + Math.random() });
}
const ffGeo = new THREE.BufferGeometry();
ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
ffGeo.setAttribute('color', new THREE.BufferAttribute(ffCol, 3));
const ffMat = new THREE.PointsMaterial({ size: 0.45, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const fireflies = new THREE.Points(ffGeo, ffMat);
fireflies.frustumCulled = false;
scene.add(fireflies);

// ---------- 小粒子：花瓣、落叶、雪团 ----------
const PART_MAX = 400;
const partMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), PART_MAX);
partMesh.count = 0;
partMesh.frustumCulled = false;
scene.add(partMesh);
const parts = [];
const tmpColor = new THREE.Color();
function emit(x, y, z, vx, vy, vz, color, size, life, flutter) {
  if (parts.length >= PART_MAX) parts.shift();
  parts.push({ x, y, z, vx, vy, vz, color: new THREE.Color(color), size, life, flutter, ph: Math.random() * 10, rot: Math.random() * 6 });
}
const canopyPoint = () => {
  const a = Math.random() * Math.PI * 2, b = Math.random() * 0.9 - 0.2;
  return [TREE.x + Math.cos(a) * 3.8 * Math.cos(b), 7.2 + Math.sin(b) * 2.4, TREE.z + Math.sin(a) * 3.4 * Math.cos(b)];
};

// ---------- 掉下来的枣 ----------
const fallen = [];
const fallenGeo = new THREE.BoxGeometry(0.34, 0.42, 0.34);
const hitGeo = new THREE.BoxGeometry(1.3, 1.3, 1.3);
const hitMat = new THREE.MeshBasicMaterial();
function dropFruit(i) {
  const s = W.fruitSpots[i];
  setFruit(i, false);
  const color = fruitColor(s.v);
  const m = new THREE.Mesh(fallenGeo, new THREE.MeshLambertMaterial({ color, transparent: true }));
  m.castShadow = true;
  m.position.set(s.x, s.y, s.z);
  const hit = new THREE.Mesh(hitGeo, hitMat);
  hit.visible = false;
  m.add(hit);
  scene.add(m);
  const f = { m, hit, vx: (Math.random() - 0.5) * 2.4, vy: 1 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 2.4, rest: false, spin: (Math.random() - 0.5) * 8, collecting: 0, ripe: state.season === 'autumn' || s.v < 0.35 };
  hit.userData.fallen = f;
  fallen.push(f);
  if (fallen.length > 40) removeFallen(fallen[0]);
}
function removeFallen(f) {
  scene.remove(f.m);
  f.m.material.dispose();
  fallen.splice(fallen.indexOf(f), 1);
}
function clearFallen() { while (fallen.length) removeFallen(fallen[0]); }

// ---------- 交互用的隐藏碰撞盒 ----------
// 树冠精修后最高叶面可能超过旧固定碰撞盒的 y=8.8 上边界。
// 根据世界生成器给出的实际树冠顶端动态扩高，保留原有水平点按范围。
const treeHitBottom = -0.4;
const treeHitTop = Math.max(10.4, W.modelQA.treeCanopyTop + 0.5);
const treeHit = new THREE.Mesh(new THREE.BoxGeometry(9, treeHitTop - treeHitBottom, 8.4), hitMat);
treeHit.position.set(TREE.x, (treeHitBottom + treeHitTop) / 2, TREE.z);
W.modelQA.treeHitTopMargin = treeHitTop - W.modelQA.treeCanopyTop;
const doorHit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 1.4), hitMat);
doorHit.position.set(W.door.x, 1.6, W.door.z + 0.6);
treeHit.visible = doorHit.visible = false;
treeHit.userData.kind = 'tree';
doorHit.userData.kind = 'door';
scene.add(treeHit, doorHit);

// ---------- 季节 ----------
const FRUIT = {
  summer: (v) => (v < 0.35 ? '#c0622f' : '#9fc94e'),
  autumn: (v) => (v < 0.25 ? '#7d1b15' : v < 0.7 ? '#a3221c' : '#b8452a'),
};
const fruitColor = (v) => (FRUIT[state.season] || FRUIT.autumn)(v);
const FLOWER = {
  spring: ['#ff8fb1', '#ffd34d', '#ffffff', '#b98cff'],
  summer: ['#ff5d5d', '#ffd34d', '#ffffff', '#5db8ff'],
  autumn: ['#e8a33d', '#9b6cd8', '#d9673a', '#f2d16b'],
};
const FLOWER_SHOW = { spring: 1, summer: 0.75, autumn: 0.35, winter: 0 };
const REED = { spring: '#5f9440', summer: '#54833a', autumn: '#a08b46', winter: '#c9b98a' };
const WATER_COL = { spring: '#4a8f86', summer: '#3f8279', autumn: '#437a78', winter: '#d2e4e6' };

function applySeason() {
  const s = state.season;
  world.recolor(s);
  if (distantSlope) distantSlope.recolor(s);
  trunk.recolor(s);
  leaves.recolor(s);
  leavesMesh.visible = s !== 'winter';
  waterMat.color.set(WATER_COL[s]);
  waterMat.opacity = s === 'winter' ? 0.95 : 0.82;
  fruitMesh.visible = s === 'summer' || s === 'autumn';
  blossomMesh.visible = s === 'spring';
  if (fruitMesh.visible) {
    W.fruitSpots.forEach((sp, i) => { fruitMesh.setColorAt(i, tmpColor.set(fruitColor(sp.v))); setFruit(i, true); });
    fruitMesh.instanceColor.needsUpdate = true;
  }
  const pal = FLOWER[s];
  if (pal) {
    flowerOrder.forEach((f, i) => petalMesh.setColorAt(i, tmpColor.set(pal[Math.floor(f.c * pal.length)])));
    petalMesh.instanceColor.needsUpdate = true;
  }
  // 春夏略收曝光，高亮草地不再像荧光板；秋冬维持原有明度。
  renderer.toneMappingExposure = (s === 'spring' || s === 'summer') ? 1.07 : 1.16;
  // 草叶跟着季节换色；冬天被雪盖住就收起来
  const tp = TUFT_COLORS[s] || TUFT_COLORS.summer;
  for (let j = 0; j < TUFT_INSTANCE_COUNT; j++) {
    tuftMesh.setColorAt(j, tmpColor.set(tp[Math.floor(tuftSeeds[j] * tp.length)]));
  }
  if (tuftMesh.instanceColor) tuftMesh.instanceColor.needsUpdate = true;
  tuftMesh.count = s === 'winter' ? 0 : TUFT_INSTANCE_COUNT;

  // 山地灌木跟随季节，色调与前景区分，避免四季都用同一抹荧光绿。
  const hc = HILL_SHRUB_COLORS[s] || HILL_SHRUB_COLORS.summer;
  W.hillShrubs.forEach((p, i) => {
    for (let k = 0; k < 2; k++) {
      const tint = Math.floor(((p.v + k * 0.31) % 1) * hc.length);
      hillShrubMesh.setColorAt(i * 2 + k, tmpColor.set(hc[tint]));
    }
  });
  if (hillShrubMesh.instanceColor) hillShrubMesh.instanceColor.needsUpdate = true;

  const shown = Math.round(flowerOrder.length * FLOWER_SHOW[s]);
  petalMesh.count = stemMesh.count = shown;
  W.reeds.forEach((_, i) => reedMesh.setColorAt(i, tmpColor.set(REED[s])));
  reedMesh.instanceColor.needsUpdate = true;
  clearFallen();
  parts.length = 0;
  document.querySelectorAll('[data-season]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.season === s)));
  $('#rain-btn').textContent = s === 'winter' ? '雪' : '雨';
  syncAudio();
}

function applyWeather() {
  buildClouds();
  document.querySelectorAll('[data-weather]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.weather === 'rain') === state.rain)));
  syncAudio();
}

// ---------- 昼夜 ----------
const COL = {
  // 天顶压深、地平线转暖：远景山脉才有空气透视，能「淡」进天色里
  dayTop: new THREE.Color('#5c9fd8'), dayBottom: new THREE.Color('#f4ecd9'),
  nightTop: new THREE.Color('#070d24'), nightBottom: new THREE.Color('#1a2448'),
  dusk: new THREE.Color('#ff9d63'), duskTop: new THREE.Color('#5d63ad'),
  rainDay: new THREE.Color('#8d97a3'), rainNight: new THREE.Color('#1d222b'),
  sunWarm: new THREE.Color('#ffc58f'), sunWhite: new THREE.Color('#fff6e8'), moon: new THREE.Color('#a9bbff'),
  glass: new THREE.Color('#a8d4e6'), glow: new THREE.Color('#ffc861'), lanternOff: new THREE.Color('#8a7a5a'),
  ambDay: new THREE.Color('#6d6353'), ambNight: new THREE.Color('#2f3a66'),
  cloudDay: new THREE.Color('#ffffff'), cloudNight: new THREE.Color('#2c3350'), cloudRain: new THREE.Color('#7b838f'), cloudDusk: new THREE.Color('#ffc2a8'),
  rainLineDay: new THREE.Color('#c0d2e4'), rainLineNight: new THREE.Color('#4a586c'),
};
const top = new THREE.Color(), bottom = new THREE.Color(), cTmp = new THREE.Color();
const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
let nightness = 0, dayness = 1;

function updateSky(hour) {
  const th = ((hour - 6) / 12) * Math.PI;
  sunDir.set(Math.cos(th), Math.sin(th), 0.38).normalize();
  const sy = sunDir.y;
  const day = smoothstep(-0.14, 0.22, sy);
  const dusk = Math.exp(-((sy - 0.03) ** 2) / 0.014);
  dayness = day;
  top.copy(COL.nightTop).lerp(COL.dayTop, day).lerp(COL.duskTop, dusk * 0.35);
  bottom.copy(COL.nightBottom).lerp(COL.dayBottom, day).lerp(COL.dusk, dusk * 0.7);
  if (state.rain) {
    cTmp.copy(COL.rainNight).lerp(COL.rainDay, day);
    top.lerp(cTmp, 0.82);
    bottom.lerp(cTmp, 0.75);
  }
  skyUniforms.top.value.copy(top);
  skyUniforms.bottom.value.copy(bottom);
  skyUniforms.mid.value.copy(bottom).lerp(top, 0.55);
  scene.fog.color.copy(bottom);
  scene.fog.near = state.rain ? 26 : 40;
  scene.fog.far = state.rain ? 110 : 168;
  // 远景山脊跟着地平线走：白天是淡蓝灰，黄昏自己会染上霞色
  // 夜里远景要暗下去：不然会变成一条比夜空还亮的白带
  const rangeK = 0.22 + 0.78 * day;
  for (const L of rangeLayers) L.mat.color.copy(bottom).lerp(L.tint, L.k * rangeK);

  const sunI = 1.5 * smoothstep(-0.03, 0.25, sy);
  const moonI = 0.6 * smoothstep(-0.05, 0.2, -sy);
  const isSun = sunI >= moonI;
  const lightDir = isSun ? sunDir : moonDir.copy(sunDir).negate();
  sun.intensity = Math.max(sunI, moonI) * (state.rain ? 0.38 : 1);
  sun.color.copy(isSun ? cTmp.copy(COL.sunWarm).lerp(COL.sunWhite, smoothstep(0.02, 0.4, sy)) : COL.moon);
  sun.position.copy(SHADOW_CENTER).addScaledVector(lightDir, 160);
  hemi.color.copy(top);
  // 地面反弹光偏草色，方块减半后竖直面太多，原来的土褐色会把整片山坡刷成横纹
  // 地面反光和天空色拉近：竖直面与水平面的半球光差太大，台阶会连成棋盘格
  hemi.groundColor.set(0xb5ab8e);
  hemi.intensity = (0.22 + 0.34 * day) * (state.rain ? 0.85 : 1);
  // 阴影里留一点底光，不然墙面在低角度太阳下会糊成一片黑
  ambient.intensity = 0.1 + 0.34 * (1 - day) + 0.3 * dusk;
  // 白天补光偏暖：草泥墙在影子里别被天光染成蓝灰
  ambient.color.copy(COL.ambDay).lerp(COL.ambNight, 1 - day);

  const R_SKY = 450;
  sunMesh.position.copy(sunDir).multiplyScalar(R_SKY);
  moonMesh.position.copy(sunDir).multiplyScalar(-R_SKY);
  sunMesh.lookAt(0, 0, 0);
  moonMesh.lookAt(0, 0, 0);
  sunMesh.material.opacity = state.rain ? 0.15 : smoothstep(-0.08, 0.02, sy);
  sunGlow.position.copy(sunDir).multiplyScalar(R_SKY - 40);
  moonGlow.position.copy(sunDir).multiplyScalar(-(R_SKY - 40));
  sunGlow.lookAt(0, 0, 0);
  moonGlow.lookAt(0, 0, 0);
  sunGlow.material.opacity = sunMesh.material.opacity * 0.8;
  moonGlow.material.opacity = moonMesh.material.opacity * 0.45;
  moonMesh.material.opacity = state.rain ? 0.1 : smoothstep(-0.08, 0.02, -sy) * 0.95;
  starMat.opacity = state.rain ? 0 : (1 - day) * 0.9;

  nightness = Math.max(1 - smoothstep(-0.06, 0.18, sy), state.rain ? 0.3 : 0);
  windowMat.color.copy(COL.glass).lerp(COL.glow, nightness);
  lanternMat.color.copy(COL.lanternOff).lerp(COL.glow, nightness);
  porchLight.intensity = nightness * 26;

  cloudMat.color.copy(COL.cloudNight).lerp(COL.cloudDay, day).lerp(COL.cloudDusk, dusk * 0.5);
  // 夜里把草地上的小花一起压暗，否则会变成一片发光的彩色噪点
  const flowerDim = 0.1 + 0.9 * day;
  stemMesh.material.color.setScalar(flowerDim);
  petalMesh.material.color.setScalar(flowerDim);
  if (state.rain) cloudMat.color.lerp(cTmp.copy(COL.cloudNight).lerp(COL.cloudRain, day), 0.8);
  rainMat.color.copy(COL.rainLineNight).lerp(COL.rainLineDay, day);
  snowMat.color.setScalar(0.45 + 0.55 * day);
}

function syncAudio() {
  const night = nightness > 0.6;
  audio.update({
    rain: state.rain,
    winter: state.season === 'winter',
    crickets: night && state.season !== 'winter' && !state.rain,
    birds: !night && (state.season === 'spring' || state.season === 'summer') && !state.rain,
  });
}

// ---------- 界面 ----------
const audio = new Ambience();
let count = 0;
try { count = parseInt(localStorage.getItem('natume.jujubes') || '0', 10) || 0; } catch { /* 无痕模式 */ }
$('#count').textContent = count;

const toastEl = $('#toast');
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}
const hintEl = $('#hint');
hintEl.textContent = isTouch ? '单指旋转 · 双指缩放 · 点点枣树、屋门、信箱和纸船' : '拖动旋转 · 滚轮缩放 · 点点枣树、屋门、信箱和纸船';
let hintTimer = setTimeout(hideHint, 9000);
function hideHint() { hintEl.classList.add('hide'); clearTimeout(hintTimer); }

document.querySelectorAll('[data-season]').forEach((b) => b.addEventListener('click', () => { state.season = b.dataset.season; applySeason(); }));
document.querySelectorAll('[data-weather]').forEach((b) => b.addEventListener('click', () => { state.rain = b.dataset.weather === 'rain'; applyWeather(); }));
const timeEl = $('#time'), clockEl = $('#clock'), realBtn = $('#realtime');
const fmt = (h) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
timeEl.addEventListener('input', () => { state.realtime = false; state.hour = parseFloat(timeEl.value); });
realBtn.addEventListener('click', () => { state.realtime = true; });
$('#sound').addEventListener('click', async (e) => {
  const on = await audio.toggle();
  e.currentTarget.setAttribute('aria-pressed', String(on));
  syncAudio();
});

const card = $('#card');
let doorTarget = 0;
const hut = initHut({ onClose: () => { doorTarget = 0; } });
$('#card-close').addEventListener('click', () => card.close());

// ---------- 两个菜单都能收起：选择记在本标签页里，画面随取随让 ----------
const store = {
  get: (k) => { try { return sessionStorage.getItem(`natume.ui.${k}`); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(`natume.ui.${k}`, v); } catch { /* 隐私模式下忽略 */ } },
};
const panel = $('#panel'), panelToggle = $('#panel-toggle'), summaryEl = $('#panel-summary');
const cardCollapse = $('#identity-collapse'), cardOpen = $('#identity-open');
const small = matchMedia('(max-width: 640px)');

function setPanel(open, remember = true) {
  panel.classList.toggle('collapsed', !open);
  panelToggle.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('panel-open', open);
  if (remember) store.set('panel', open ? '1' : '0');
}
function setCard(open, remember = true) {
  document.body.classList.toggle('identity-hidden', !open);
  cardCollapse.setAttribute('aria-expanded', String(open));
  cardOpen.setAttribute('aria-expanded', String(open));
  if (remember) store.set('card', open ? '1' : '0');
}
// 桌面默认展开面板、手机默认收起；名片默认展开。自己选过就听自己的
const savedPanel = store.get('panel'), savedCard = store.get('card');
setPanel(savedPanel === null ? !small.matches : savedPanel === '1', false);
setCard(savedCard === null ? true : savedCard === '1', false);
small.addEventListener('change', (e) => { if (store.get('panel') === null) setPanel(!e.matches, false); });
panelToggle.addEventListener('click', () => { setPanel(panel.classList.contains('collapsed')); hideHint(); });
cardCollapse.addEventListener('click', () => { setCard(false); cardOpen.focus({ preventScroll: true }); hideHint(); });
cardOpen.addEventListener('click', () => { setCard(true); cardCollapse.focus({ preventScroll: true }); hideHint(); });
const SEASON_CN = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const summary = () => `${SEASON_CN[state.season]} · ${state.rain ? (state.season === 'winter' ? '雪' : '雨') : '晴'} · ${fmt(state.hour)}`;

function bumpCounter() {
  try { localStorage.setItem('natume.jujubes', String(count)); } catch { /* 忽略 */ }
  const el = $('#count');
  el.textContent = count;
  const box = $('#counter');
  box.classList.remove('bump');
  void box.offsetWidth;
  box.classList.add('bump');
}

// ---------- 点击 ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let shake = 0, toldPickup = false, mailWiggle = 0;
function setRay(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function pickKind(cx, cy) {
  setRay(cx, cy);
  const fh = ray.intersectObjects(fallen.filter((f) => !f.collecting).map((f) => f.hit), false);
  if (fh.length) return { kind: 'fruit', f: fh[0].object.userData.fallen };
  const h = ray.intersectObjects([treeHit, doorHit, mailHit, signHit, boatHit], false);
  if (!h.length) return null;
  return { kind: h[0].object.userData.kind };
}
function onTap(cx, cy) {
  const p = pickKind(cx, cy);
  if (!p) return;
  hideHint();
  controls.autoRotate = false;
  if (p.kind === 'fruit') {
    p.f.collecting = 0.001;
    count++;
    bumpCounter();
    audio.pop();
    toast(p.f.ripe ? '+1 颗红枣' : '+1 颗青枣');
  } else if (p.kind === 'tree') {
    shake = 1;
    audio.rustle();
    const s = state.season;
    if (s === 'summer' || s === 'autumn') {
      const alive = fruitAlive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
      if (!alive.length) { toast('枣子都摇下来啦，过一会儿还会再长'); return; }
      const n = Math.min(alive.length, 2 + Math.floor(Math.random() * 2));
      for (let k = 0; k < n; k++) dropFruit(alive.splice(Math.floor(Math.random() * alive.length), 1)[0]);
      if (!toldPickup) { toast('枣子掉下来了，点一下就能捡起来'); toldPickup = true; }
    } else if (s === 'spring') {
      for (let k = 0; k < 16; k++) { const [x, y, z] = canopyPoint(); emit(x, y, z, (Math.random() - 0.5), -0.3, (Math.random() - 0.5), Math.random() < 0.5 ? '#f5e27a' : '#fff6c9', 0.16, 6, true); }
      toast('枣花开了，夏天和秋天再来摇枣吧');
    } else {
      for (let k = 0; k < 24; k++) { const [x, y, z] = canopyPoint(); emit(x, y - 1, z, (Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2, '#ffffff', 0.2, 3, false); }
      toast('冬天的枣树在休息');
    }
  } else if (p.kind === 'door') {
    audio.knock();
    doorTarget = 1;
    setTimeout(() => { if (!card.open) hut.open('about'); }, 420);
  } else if (p.kind === 'mail') {
    audio.knock();
    mailWiggle = 1;
    toast('把想说的话投进信箱吧');
    setTimeout(() => hut.open('guestbook'), 300);
  } else if (p.kind === 'sign') {
    audio.knock();
    hut.open('works');
  } else if (p.kind === 'boat') {
    audio.pop();
    toast('纸船上写着一篇日记');
    hut.latestDiary().then((post) => hut.open('diary', post ? post.slug : null));
  }
}
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  if (moved < 8 && performance.now() - down.t < 600) onTap(e.clientX, e.clientY);
  down = null;
});
if (!isTouch) {
  let last = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - last < 60 || e.buttons) return;
    last = now;
    renderer.domElement.style.cursor = pickKind(e.clientX, e.clientY) ? 'pointer' : 'grab';
  });
}

// 相机视线不能被山或树挡住：先拉近，拉到最近还挡着再抬高视角
const camOffset = new THREE.Vector3(), camSph = new THREE.Spherical(), probe = new THREE.Vector3();
function groundAt(x, z) {
  let h = -1;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const v = W.topAt(Math.round(x) + dx, Math.round(z) + dz);
    if (v !== -99) h = Math.max(h, v);
  }
  return h;
}
function blocked(offset) {
  const len = offset.length();
  for (let s = 12; s <= len; s += 1) {
    probe.copy(offset).multiplyScalar(s / len).add(controls.target);
    if (probe.y < groundAt(probe.x, probe.z) + 1.5) return true;
  }
  return false;
}
function keepAboveGround() {
  camOffset.copy(camera.position).sub(controls.target);
  camSph.setFromVector3(camOffset);
  for (let guard = 0; guard < 120; guard++) {
    camOffset.setFromSpherical(camSph);
    if (!blocked(camOffset)) break;
    if (camSph.radius > controls.minDistance + 0.5) camSph.radius -= 0.75;
    else if (camSph.phi > controls.minPolarAngle) camSph.phi -= 0.03;
    else break;
  }
  camOffset.setFromSpherical(camSph);
  camera.position.copy(controls.target).add(camOffset);
}

// ---------- 动画循环 ----------
const timer = new THREE.Timer();
timer.connect(document);
let time = 0, regrowTimer = 0, ambientTimer = 0, cloudOffset = 0, audioTimer = 0;
// 炊烟必须从烟囱帽上方升起，不能沿用旧屋顶高度的硬编码 9。
const chim = { x: W.chimney.x, y: W.chimney.y + 0.28, z: W.chimney.z };

// 自动画质：帧率持续偏低时先关阴影，再降分辨率
let quality = 2, qFrames = 0, qTime = 0, qWarm = 0;
function setQuality(q) {
  quality = q;
  const shadows = q >= 2;
  if (renderer.shadowMap.enabled !== shadows) {
    renderer.shadowMap.enabled = shadows;
    sun.castShadow = shadows;
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  }
  renderer.setPixelRatio(q >= 1 ? Math.min(devicePixelRatio, isTouch ? 1.75 : 2) : 1);
  renderer.setSize(innerWidth, innerHeight);
}
if (params.get('quality') === 'low') setQuality(0);
function trackQuality(raw) {
  qWarm += raw;
  if (qWarm < 4 || quality === 0) return;
  qFrames++; qTime += raw;
  if (qTime >= 4) {
    if (qFrames / qTime < 30) setQuality(quality - 1);
    qFrames = 0; qTime = 0;
  }
}
document.addEventListener('visibilitychange', () => {
  renderer.setAnimationLoop(document.hidden ? null : frame);
  qWarm = 0; qFrames = 0; qTime = 0;
});

let summaryTimer = 0;
function frame() {
  timer.update();
  const raw = timer.getDelta();
  trackQuality(raw);
  const dt = Math.min(raw, 0.05);
  time += dt;
  if (state.realtime) {
    const now = new Date();
    state.hour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }
  if (document.activeElement !== timeEl) timeEl.value = state.hour.toFixed(2);
  clockEl.textContent = fmt(state.hour);
  summaryTimer += dt;
  if (summaryTimer > 0.5) { summaryTimer = 0; summaryEl.textContent = summary(); }
  realBtn.setAttribute('aria-pressed', String(state.realtime));
  updateSky(state.hour);
  skyGroup.position.copy(camera.position);
  audioTimer += dt;
  if (audioTimer > 2) { audioTimer = 0; syncAudio(); }

  // 树摇晃
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 1.1);
    treeGroup.rotation.z = Math.sin(time * 32) * 0.045 * shake;
    treeGroup.rotation.x = Math.cos(time * 27) * 0.03 * shake;
  } else {
    const breeze = state.rain ? 0.012 : 0.005;
    treeGroup.rotation.z = Math.sin(time * 1.3) * breeze;
    treeGroup.rotation.x = Math.cos(time * 1.1) * breeze * 0.6;
  }
  // 门
  doorPivot.rotation.y += (doorTarget * 1.45 - doorPivot.rotation.y) * Math.min(1, dt * 7);

  // 水流
  if (state.season !== 'winter') waterTex.offset.x -= dt * 0.22;

  // 纸船顺水漂，冬天冻在冰面上
  if (state.season !== 'winter') {
    boatX += dt * (state.rain ? 1.3 : 0.8);
    if (boatX > BOAT_X1) boatX = BOAT_X0;
  }
  {
    const z = riverZ(boatX), dz = riverZ(boatX + 0.5) - z;
    const bob = state.season === 'winter' ? 0 : Math.sin(time * 2.1) * (state.rain ? 0.06 : 0.03);
    boat.position.set(boatX, 0.36 + bob, z);
    boat.rotation.set(0, -Math.atan2(dz, 0.5), state.season === 'winter' ? 0 : Math.sin(time * 1.7) * 0.06);
    const edge = Math.min(boatX - BOAT_X0, BOAT_X1 - boatX);
    boat.scale.setScalar(smoothstep(0, 2, edge));
  }
  // 信箱小旗
  mailWiggle = Math.max(0, mailWiggle - dt * 1.5);
  mailFlag.rotation.x = Math.sin(time * 18) * 0.35 * mailWiggle;

  // 炊烟
  smoke.forEach((m, i) => {
    const a = (time * 0.22 + i / smoke.length) % 1;
    // 小团、散开、越飘越淡：原来是一列大方块，远看像根半透明的烟囱
    m.position.set(
      chim.x + Math.sin(a * 5 + i) * 0.5 + a * 2.2,
      chim.y + a * 4.6,
      chim.z + Math.cos(a * 4 + i) * 0.35,
    );
    const size = 0.12 + a * 0.34;
    m.scale.set(size, size * 0.8, size);
    m.rotation.set(a * 2.2 + i, a * 3.1, i * 0.7);
    m.material.opacity = Math.pow(1 - a, 1.5) * (state.rain ? 0.18 : 0.34);
  });

  // 云
  cloudOffset += dt * 1.4;
  if (cloudOffset >= CELL) { cloudOffset -= CELL; cloudShift -= 1; buildClouds(); }
  cloudGroup.position.x = cloudOffset;

  // 雨 / 雪
  const raining = state.rain && state.season !== 'winter';
  const snowing = state.rain && state.season === 'winter';
  rain.visible = raining;
  snow.visible = snowing;
  const cx = controls.target.x, cz = controls.target.z;
  if (raining) {
    for (let i = 0; i < RAIN_N; i++) {
      const o = i * 6;
      let y = rainPos[o + 1] - rainSpeed[i] * dt;
      if (y < 0) {
        y = TOPY + Math.random() * 6;
        const x = cx + (Math.random() * 2 - 1) * AREA, z = cz + (Math.random() * 2 - 1) * AREA;
        rainPos[o] = rainPos[o + 3] = x; rainPos[o + 2] = rainPos[o + 5] = z;
      }
      rainPos[o + 1] = y; rainPos[o + 4] = y + 0.9;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  if (snowing) {
    for (let i = 0; i < SNOW_N; i++) {
      const o = i * 3;
      let y = snowPos[o + 1] - (1.6 + (i % 5) * 0.25) * dt;
      snowPos[o] += Math.sin(time * 0.8 + snowPhase[i]) * dt * 0.6;
      if (y < 0.5) {
        y = TOPY;
        snowPos[o] = cx + (Math.random() * 2 - 1) * AREA;
        snowPos[o + 2] = cz + (Math.random() * 2 - 1) * AREA;
      }
      snowPos[o + 1] = y;
    }
    snowGeo.attributes.position.needsUpdate = true;
  }

  // 萤火虫
  const ffOn = state.season !== 'winter' && !state.rain ? smoothstep(0.5, 0.9, nightness) : 0;
  fireflies.visible = ffOn > 0.01;
  if (fireflies.visible) {
    for (let i = 0; i < FF_N; i++) {
      const b = ffBase[i];
      ffPos[i * 3] = b.x + Math.sin(time * 0.4 * b.s + b.p) * 1.6;
      ffPos[i * 3 + 1] = b.y + Math.sin(time * 0.9 * b.s + b.p * 2) * 0.5;
      ffPos[i * 3 + 2] = b.z + Math.cos(time * 0.35 * b.s + b.p) * 1.6;
      const blink = Math.max(0, Math.sin(time * 2.2 * b.s + b.p * 3)) * ffOn;
      ffCol[i * 3] = 0.85 * blink; ffCol[i * 3 + 1] = 1 * blink; ffCol[i * 3 + 2] = 0.45 * blink;
    }
    ffGeo.attributes.position.needsUpdate = true;
    ffGeo.attributes.color.needsUpdate = true;
  }

  // 环境落花、落叶
  ambientTimer += dt;
  if (ambientTimer > (state.season === 'spring' ? 0.7 : 1.0)) {
    ambientTimer = 0;
    if (state.season === 'spring' || state.season === 'autumn') {
      const [x, y, z] = canopyPoint();
      const c = state.season === 'spring' ? (Math.random() < 0.5 ? '#f5e27a' : '#fff6c9') : (Math.random() < 0.5 ? '#d9b83a' : '#a6b842');
      emit(x, y, z, 0, -0.2, 0, c, state.season === 'spring' ? 0.14 : 0.2, 9, true);
    }
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    if (p.y > 0.56) {
      if (p.flutter) {
        p.vx += Math.sin(time * 2.3 + p.ph) * dt * 1.2;
        p.vz += Math.cos(time * 1.9 + p.ph) * dt * 1.2;
        p.vy = Math.max(p.vy - dt * 2, -0.9);
        p.vx *= 0.98; p.vz *= 0.98;
      } else p.vy -= dt * 9;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += dt * 3;
    } else { p.y = 0.56; p.life = Math.min(p.life, 1.5); }
  }
  partMesh.count = parts.length;
  parts.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(p.rot, p.rot * 0.7, 0);
    dummy.scale.set(p.size, p.flutter ? p.size * 0.35 : p.size, p.size);
    dummy.scale.multiplyScalar(Math.min(1, p.life / 0.5));
    dummy.updateMatrix();
    partMesh.setMatrixAt(i, dummy.matrix);
    partMesh.setColorAt(i, p.color);
  });
  if (parts.length) {
    partMesh.instanceMatrix.needsUpdate = true;
    partMesh.instanceColor.needsUpdate = true;
  }

  // 掉落的枣
  for (let i = fallen.length - 1; i >= 0; i--) {
    const f = fallen[i];
    const m = f.m;
    if (f.collecting) {
      f.collecting += dt * 2.6;
      m.position.y += dt * 3;
      m.scale.setScalar(1 + f.collecting * 0.8);
      m.material.opacity = Math.max(0, 1 - f.collecting);
      if (f.collecting >= 1) removeFallen(f);
      continue;
    }
    if (f.rest) continue;
    f.vy -= 22 * dt;
    m.position.x += f.vx * dt; m.position.y += f.vy * dt; m.position.z += f.vz * dt;
    m.rotation.x += f.spin * dt; m.rotation.z += f.spin * 0.7 * dt;
    const ground = 0.71;
    if (m.position.y <= ground) {
      m.position.y = ground;
      if (Math.abs(f.vy) > 2.5) { f.vy = -f.vy * 0.32; f.vx *= 0.5; f.vz *= 0.5; }
      else { f.rest = true; m.rotation.set(0, m.rotation.y, Math.PI / 2 * Math.round(m.rotation.z / (Math.PI / 2))); }
    }
  }

  // 枣子慢慢长回来
  regrowTimer += dt;
  if (regrowTimer > 10) {
    regrowTimer = 0;
    if (fruitMesh.visible) {
      const dead = fruitAlive.map((a, i) => (a ? -1 : i)).filter((i) => i >= 0);
      if (dead.length) setFruit(dead[Math.floor(Math.random() * dead.length)], true);
    }
  }

  // 萤火虫：入夜后出现，白天与下雨时隐藏
  fireT += dt;
  const fireOn = nightness > 0.22 && !state.rain;
  fireMesh.visible = fireOn;
  if (fireOn) {
    fireMat.opacity = 0.55 * smoothstep(0.22, 0.75, nightness);
    for (let i = 0; i < FIRE_N; i++) {
      const s = fireSeeds[i];
      const t = fireT * s.sp + s.ph;
      dummy.position.set(
        s.ax + Math.cos(t) * s.rr,
        s.y + Math.sin(t * 1.7) * 0.35,
        s.az + Math.sin(t * 0.8) * s.rr,
      );
      dummy.rotation.set(t * 0.4, t * 0.6, 0);
      dummy.scale.setScalar(0.55 + 0.45 * Math.max(0, Math.sin(t * 2.2)));
      dummy.updateMatrix();
      fireMesh.setMatrixAt(i, dummy.matrix);
    }
    fireMesh.instanceMatrix.needsUpdate = true;
  }

  // 蝴蝶：只有晴天的白天出来
  bflyT += dt;
  const bflyOn = !state.rain && dayness > 0.55 && state.season !== 'winter';
  bflyMesh.visible = bflyOn;
  if (bflyOn) {
    bflyMat.opacity = 0.95;
    for (let i = 0; i < BFLY_N; i++) {
      const q = bflySeeds[i];
      const t = bflyT * q.sp + q.ph;
      dummy.position.set(
        q.x + Math.cos(t) * q.r,
        q.y + Math.sin(t * 2.3) * 0.22 + 0.1,
        q.z + Math.sin(t * 1.3) * q.r,
      );
      dummy.rotation.set(0, t * 0.7, Math.sin(t * 7) * 0.5);
      dummy.scale.setScalar(0.8 + Math.sin(t * 9) * 0.25);
      dummy.updateMatrix();
      bflyMesh.setMatrixAt(i, dummy.matrix);
    }
    bflyMesh.instanceMatrix.needsUpdate = true;
  }

  if (sailGroup) sailGroup.rotation.z += dt * 0.42;

  controls.update();
  keepAboveGround();
  renderer.render(scene, camera);
}

applySeason();
applyWeather();
updateSky(state.hour);
renderer.setAnimationLoop(frame);
$('#loading').classList.add('hide');
summaryEl.textContent = summary();
if (hut.initial) {
  doorTarget = 1;
  controls.autoRotate = false;
  hut.open(hut.initial.tab, hut.initial.slug);
}

// 方便调试：在控制台查看
window.__natume = {
  state, scene, camera, controls, faces: world.faces,
  lodFaces: distantSlope?.faces ?? 0, lodEnabled: useDistantLOD,
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
  },
  fallen: () => fallen.map((f) => [f.m.position.x, f.m.position.y, f.m.position.z, f.rest]),
  props: () => ({ mail: mailbox.position.toArray(), sign: signpost.position.toArray(), boat: boat.position.toArray() }),
  quality: () => quality,
  modelQA: W.modelQA,
};

// 仅在 ?qa=1 时向 DOM 暴露非敏感的几何验收数据，供云端浏览器直接读取。
// 中心线归零还不够：必须同时确认窗洞不被框架覆盖、树冠可点按。
if (params.get('qa') === '1') {
  const qa = W.modelQA;
  const checks = {
    doorCentered: qa.doorCenterError === 0,
    frontWindowsMirrored: qa.frontWindowMirrorError === 0,
    sideWindowsAligned: qa.sideWindowAlignError === 0,
    windowsUnobstructed: qa.totalWindowObstructions === 0,
    treeCanopyTouchableAtTop: qa.treeHitTopMargin >= 0.45,
  };
  const output = document.createElement('output');
  output.id = 'natume-model-qa';
  output.hidden = true;
  output.dataset.pass = String(Object.values(checks).every(Boolean));
  output.textContent = JSON.stringify({ checks, qa });
  document.body.appendChild(output);
}
