import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import {
  generateWorld, buildMesh, filters, makeAtlas, TILE_ID, TREE, fbm, smoothstep, hash3, riverZ, V,
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
renderer.toneMappingExposure = 1.08;
$('#app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe0f5, 62, 210);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.3, 1200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-1, 4, -2);
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
  camera.fov = a < 0.8 ? 64 : a < 1.2 ? 56 : 50;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
{
  const a = innerWidth / innerHeight;
  const dist = a < 0.8 ? 40 : 36;
  const az = 0.62, pol = 1.28;
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
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
const SHADOW_CENTER = new THREE.Vector3(-1, 0, -2);
sun.target.position.copy(SHADOW_CENTER);

// ---------- 世界 ----------
const atlas = makeAtlas();
const tileTexture = (tile) => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  cv.getContext('2d').drawImage(atlas.image, tile * 16, 0, 16, 16, 0, 0, 16, 16);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
};
const blockMat = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true });

const W = generateWorld();
const world = buildMesh(W.grid, filters.world);
const worldMesh = new THREE.Mesh(world.geometry, blockMat);
worldMesh.castShadow = worldMesh.receiveShadow = true;
// 网格按细分倍数缩小回世界尺度：方块更细，世界范围不变
worldMesh.scale.setScalar(1 / V);
scene.add(worldMesh);

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
  const uv = water.geometry.attributes.uv.array;
  // 每个小块 8 次重复，和原来每个整块 16 次的水纹密度一致
  for (let i = 0; i < uv.length; i += 2) uv[i] *= 16 / V;
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
  const geo = w.axis === 'z' ? new THREE.BoxGeometry(1, 1, 0.14) : new THREE.BoxGeometry(0.14, 1, 1);
  const m = new THREE.Mesh(geo, windowMat);
  m.position.set(w.x, w.y, w.z);
  scene.add(m);
}

const plankTex = tileTexture(TILE_ID.PLANK);
const doorPivot = new THREE.Group();
doorPivot.position.set(W.door.x - 0.5, 1.5 - 0.5 / V, W.door.z + 0.38);
const door = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.16), new THREE.MeshLambertMaterial({ map: plankTex, color: 0x9a6a40 }));
door.position.x = 0.5;
door.castShadow = true;
const knob = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: 0xe0b85a }));
knob.position.set(0.78, -0.05, 0.12);
door.add(knob);
doorPivot.add(door);
scene.add(doorPivot);

const lanternMat = new THREE.MeshBasicMaterial({ color: 0x8a7a5a });
const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.34), lanternMat);
lantern.position.set(W.door.x - 1.2, 2.2, W.door.z + 0.72);
const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.4), new THREE.MeshLambertMaterial({ color: 0x3a2a1a }));
bracket.position.set(0, 0.3, -0.2);
lantern.add(bracket);
scene.add(lantern);
const porchLight = new THREE.PointLight(0xffc46b, 0, 22, 1.6);
porchLight.position.set(W.door.x - 0.5, 2.6, W.door.z + 2);
scene.add(porchLight);

// ---------- 小桥 ----------
{
  const b = W.bridge;
  const mat = new THREE.MeshLambertMaterial({ map: plankTex, color: 0xc0915a });
  const cols = Math.round(b.x1 - b.x0), rows = Math.round(b.z1 - b.z0);
  const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.26, 0.92), mat, cols * rows);
  let n = 0;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    dummy.position.set(b.x0 + 0.5 + i, 0.5, b.z0 + 0.5 + j);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    planks.setMatrixAt(n++, dummy.matrix);
  }
  planks.castShadow = planks.receiveShadow = true;
  scene.add(planks);
  const postMat = new THREE.MeshLambertMaterial({ map: tileTexture(TILE_ID.LOG), color: 0x6b4a2e });
  const posts = [];
  for (const x of [b.x0 - 0.05, b.x1 + 0.05]) {
    for (let z = b.z0; z <= b.z1 + 0.01; z += (b.z1 - b.z0) / 3) posts.push([x, z]);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, b.z1 - b.z0), postMat);
    rail.position.set(x, 1.25, (b.z0 + b.z1) / 2);
    rail.castShadow = true;
    scene.add(rail);
  }
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), postMat, posts.length);
  posts.forEach(([x, z], i) => {
    dummy.position.set(x, 0.85, z);
    dummy.updateMatrix();
    postMesh.setMatrixAt(i, dummy.matrix);
  });
  postMesh.castShadow = true;
  scene.add(postMesh);
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

const MAILBOX = { x: -11.7, z: -4.3 };
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

const reedMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 1, 0.09), new THREE.MeshLambertMaterial(), W.reeds.length);
const cattailMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.32, 0.16), new THREE.MeshLambertMaterial({ color: 0x7a5232 }), W.reeds.length);
W.reeds.forEach((r, i) => {
  dummy.rotation.set((r.v - 0.5) * 0.25, 0, (r.v - 0.5) * 0.3);
  dummy.scale.set(1, r.h, 1);
  dummy.position.set(r.x, 0.5 + r.h / 2, r.z);
  dummy.updateMatrix();
  reedMesh.setMatrixAt(i, dummy.matrix);
  dummy.scale.setScalar(1);
  dummy.position.set(r.x, 0.5 + r.h + 0.1, r.z);
  dummy.updateMatrix();
  cattailMesh.setMatrixAt(i, dummy.matrix);
});
reedMesh.castShadow = true;
scene.add(reedMesh, cattailMesh);

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
const skyUniforms = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(600, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP;\nvoid main() {\n  float h = clamp(vP.y * 1.8 + 0.12, 0.0, 1.0);\n  gl_FragColor = vec4(mix(bottom, top, pow(h, 0.75)), 1.0);\n  #include <tonemapping_fragment>\n  #include <colorspace_fragment>\n}',
    side: THREE.BackSide, depthWrite: false, fog: false,
  }),
);
skyDome.renderOrder = -10;
skyGroup.add(skyDome);
const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), new THREE.MeshBasicMaterial({ color: 0xfff0b0, fog: false, transparent: true, depthWrite: false }));
const moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ color: 0xe8eef8, fog: false, transparent: true, depthWrite: false }));
skyGroup.add(sunMesh, moonMesh);
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
    dummy.scale.set(CELL, 2.6 + (v - thr) * 6, CELL);
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
const treeHit = new THREE.Mesh(new THREE.BoxGeometry(9, 8, 8.4), hitMat);
treeHit.position.set(TREE.x, 4.8, TREE.z);
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
const REED = { spring: '#6f9e45', summer: '#5f8f3a', autumn: '#b59a52', winter: '#c9b98a' };
const WATER_COL = { spring: '#4a9fd8', summer: '#3d93cf', autumn: '#3b84bd', winter: '#d3e9f2' };

function applySeason() {
  const s = state.season;
  world.recolor(s);
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
  dayTop: new THREE.Color('#4f9be0'), dayBottom: new THREE.Color('#c4e3f6'),
  nightTop: new THREE.Color('#070d24'), nightBottom: new THREE.Color('#1a2448'),
  dusk: new THREE.Color('#ff9d63'), duskTop: new THREE.Color('#5d63ad'),
  rainDay: new THREE.Color('#8d97a3'), rainNight: new THREE.Color('#1d222b'),
  sunWarm: new THREE.Color('#ffc58f'), sunWhite: new THREE.Color('#fff6e8'), moon: new THREE.Color('#a9bbff'),
  glass: new THREE.Color('#a8d4e6'), glow: new THREE.Color('#ffc861'), lanternOff: new THREE.Color('#8a7a5a'),
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
  scene.fog.color.copy(bottom);
  scene.fog.near = state.rain ? 40 : 70;
  scene.fog.far = state.rain ? 150 : 230;

  const sunI = 2.7 * smoothstep(-0.03, 0.25, sy);
  const moonI = 0.6 * smoothstep(-0.05, 0.2, -sy);
  const isSun = sunI >= moonI;
  const lightDir = isSun ? sunDir : moonDir.copy(sunDir).negate();
  sun.intensity = Math.max(sunI, moonI) * (state.rain ? 0.38 : 1);
  sun.color.copy(isSun ? cTmp.copy(COL.sunWarm).lerp(COL.sunWhite, smoothstep(0.02, 0.4, sy)) : COL.moon);
  sun.position.copy(SHADOW_CENTER).addScaledVector(lightDir, 160);
  hemi.color.copy(top);
  // 地面反弹光偏草色，方块减半后竖直面太多，原来的土褐色会把整片山坡刷成横纹
  hemi.groundColor.set(0x7d8462);
  hemi.intensity = (0.4 + 0.8 * day) * (state.rain ? 0.8 : 1);
  // 阴影里留一点底光，不然墙面在低角度太阳下会糊成一片黑
  ambient.intensity = 0.14 + 0.5 * (1 - day) + 0.45 * dusk;

  const R_SKY = 450;
  sunMesh.position.copy(sunDir).multiplyScalar(R_SKY);
  moonMesh.position.copy(sunDir).multiplyScalar(-R_SKY);
  sunMesh.lookAt(0, 0, 0);
  moonMesh.lookAt(0, 0, 0);
  sunMesh.material.opacity = state.rain ? 0.15 : smoothstep(-0.08, 0.02, sy);
  moonMesh.material.opacity = state.rain ? 0.1 : smoothstep(-0.08, 0.02, -sy) * 0.95;
  starMat.opacity = state.rain ? 0 : (1 - day) * 0.9;

  nightness = Math.max(1 - smoothstep(-0.06, 0.18, sy), state.rain ? 0.3 : 0);
  windowMat.color.copy(COL.glass).lerp(COL.glow, nightness);
  lanternMat.color.copy(COL.lanternOff).lerp(COL.glow, nightness);
  porchLight.intensity = nightness * 26;

  cloudMat.color.copy(COL.cloudNight).lerp(COL.cloudDay, day).lerp(COL.cloudDusk, dusk * 0.5);
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

// 手机上控制面板默认收起
const panel = $('#panel'), panelToggle = $('#panel-toggle'), summaryEl = $('#panel-summary');
const small = matchMedia('(max-width: 640px)');
function setPanel(open) {
  panel.classList.toggle('collapsed', !open);
  panelToggle.setAttribute('aria-expanded', String(open));
}
setPanel(!small.matches);
small.addEventListener('change', (e) => setPanel(!e.matches));
panelToggle.addEventListener('click', () => { setPanel(panel.classList.contains('collapsed')); hideHint(); });
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
const chim = { x: W.chimney.x, y: 9, z: W.chimney.z };

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
    m.position.set(chim.x + Math.sin(a * 5 + i) * 0.4 + a * 1.6, chim.y + a * 6, chim.z + Math.cos(a * 4 + i) * 0.3);
    m.scale.setScalar(0.35 + a * 0.9);
    m.material.opacity = (1 - a) * (state.rain ? 0.3 : 0.55);
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
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
  },
  fallen: () => fallen.map((f) => [f.m.position.x, f.m.position.y, f.m.position.z, f.rest]),
  props: () => ({ mail: mailbox.position.toArray(), sign: signpost.position.toArray(), boat: boat.position.toArray() }),
  quality: () => quality,
};
