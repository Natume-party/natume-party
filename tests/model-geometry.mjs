// Natume V3.2 geometry regression: node tests/model-geometry.mjs
// Run the real world generator at both voxel densities without needing WebGL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'public/js/world.js'), 'utf8');
const boundary = source.indexOf('export const ATLAS');
assert.ok(boundary > 0, 'Cannot locate world-generation boundary');
// Regression of the windmill rotor's entire 360° sweep relative to the tower face.
const mainSource = readFileSync(resolve(root, 'public/js/main.js'), 'utf8');
const sailBlock = mainSource.slice(mainSource.indexOf('let sailGroup = null;'),
  mainSource.indexOf('// ---------- 门外的小物件'));
assert.ok(sailBlock.includes('sailGroup.rotation.y = 0;'),
  'Rotor must stay parallel to the tower front during the entire 360-degree sweep');
const forward = Number(sailBlock.match(/sailGroup\.position\.z \+= ([\d.]+);/)?.[1]);
const axleDepth = Number(sailBlock.match(/BoxGeometry\(0\.47, 0\.47, ([\d.]+)\)/)?.[1]);
assert.ok(Number.isFinite(forward) && Number.isFinite(axleDepth),
  'Rotor offset and axle geometry must be verifiable');

// User-visible props must have both physical grounding and shadows, even with adaptive quality.
for (const fragment of [
  'stemMesh.castShadow = petalMesh.castShadow = true',
  'reedMesh.castShadow = cattailMesh.castShadow = true',
  'hillShrubMesh.castShadow = true',
  'stoneMesh.castShadow = true',
  'scene.add(contactMesh)',
  'const reedGeo = new THREE.BufferGeometry()',
]) assert.ok(mainSource.includes(fragment), 'Lost detail grounding/shadow behavior: ' + fragment);
// Boat must give an immediate physical response before reopening the existing diary.
for (const fragment of [
  "p.kind === 'boat'",
  'boatPush = 3.2',
  'boatRippleTime = 1',
  'boatTapCount++',
  'boatX += dt * ((state.rain ? 1.3 : 0.8) + boatPush)',
  "hut.latestDiary().then((post) => hut.open('diary'",
  'boatQA: () =>',
]) assert.ok(mainSource.includes(fragment), 'Lost paper-boat action: ' + fragment);

const generator = source.slice(0, boundary)
  .replace(/^import \* as THREE from 'three';\s*/m, '')
  .replace(/\bexport (?=(const|function|class)\b)/g, '');

for (const touch of [true, false]) {
  const scope = {
    matchMedia: (query) => ({ matches: touch && query === '(pointer: coarse)' }),
  };
  runInNewContext(generator + '\nglobalThis.testWorld = { V, generateWorld, T, HUT, TREE, FIELD, riverZ, RIVER_HALF };', scope);
  const { V, generateWorld, T, HUT, TREE, FIELD, riverZ, RIVER_HALF } = scope.testWorld;
  assert.equal(V, touch ? 2 : 3, 'Voxel density mismatches test device');
  const world = generateWorld();
  const { modelQA: qa } = world;
  // River plants must be generated from real shore cells, not arbitrary y offsets.
  assert.equal(qa.reedFloatingCount, 0, 'No reeds may spawn above unsupported ground');
  assert.ok(world.reeds.length >= 15, 'Keep believable natural riverbank clusters');
  assert.ok(world.reeds.some(r => r.cattail), 'Sparse cattail heads must be present');
  for (const reed of world.reeds) {
    const bankTop = (Math.round(world.getH(reed.x, reed.z) * V) + 0.5) / V;
    assert.ok(Math.abs(reed.y - (bankTop - 0.025)) < 1e-5,
      'Reed must meet the local riverbank instead of floating');
    assert.ok(reed.h >= 0.32 && reed.h <= 0.85,
      'Reed should keep tapered low wetland proportions');
  }
  assert.equal(qa.doorCenterError, 0, 'Door must be centered');
  assert.equal(qa.frontWindowMirrorError, 0, 'Front windows must mirror');
  assert.equal(qa.sideWindowAlignError, 0, 'Side windows must align');
  assert.deepEqual(Array.from(qa.windowObstructions), [0, 0, 0, 0], 'Openings cannot be covered by timber');
  assert.equal(qa.totalWindowObstructions, 0, 'No window may contain an occluding voxel');
  assert.ok(Number.isFinite(qa.treeCanopyTop), 'Canopy must have a finite top');
  // The house moved inland by 2 units; the walking route and chimney must move with it.
  assert.equal(HUT.z1, -9, 'Cottage should stand inland of its earlier riverbank position');
  assert.equal(world.door.z, HUT.z1, 'Door anchor must follow house front');
  assert.equal(world.chimney.z, HUT.z0 + 2, 'Chimney must follow new roof position');
  assert.ok(world.yard.bankDistance >= 7, 'Cottage must be sufficiently far from the river bank');
  assert.equal(world.yard.pathStartZ, HUT.z1 + 0.3, 'Walkway must start in front of the relocated entrance');
  assert.ok(qa.cottageRoofRise >= 1.2 && qa.cottageRoofRise <= 2.1, 'Cottage roof pitch should be human scale');
  assert.equal(qa.cottageRoofAxisError, 0, 'Opposite roof slopes must mirror');
  assert.ok(world.chimney.y > 6, 'The chimney cap must project above the pitched roof');
  assert.ok(qa.heroCanopyDiameter >= 6.9 && qa.heroCanopyDiameter <= 7.8,
    'Hero canopy should retain the broader V3.2 shade silhouette');
  assert.ok(qa.cottageWidth >= 6.5 && qa.cottageWidth <= 7.3,
    'Cottage should be modestly enlarged rather than oversized');
  assert.ok(qa.cottageDepth >= 4.25 && qa.cottageDepth <= 5,
    'Cottage extra depth must remain proportionate');
  assert.equal(world.yard.connectsToTree, true, 'Courtyard spur must reach the hero tree');
  // Farm visitors need a separate continuous path from orchard yard to the field's working edge.
  for (let i = 0; i <= 7; i++) {
    const t = i / 7, x = 3.8 + (FIELD.x0 - 1.05 - 3.8) * t;
    const z = -4.96 - 3.04 * t - 0.13 * Math.sin(Math.PI * t);
    assert.equal(surface(x, z), T.PATH, 'Farm approach disconnected at sample ' + i);
  }
  // The windmill trail must go around the house and stop before the stone tower foundation.
  for (const [x, z] of [[-5.7, -6.5], [-3.5, -10], [-3.5, -13],
    [-3.5, -17.5], [-5.4, -22.5], [-8, -26.2]]) {
    assert.equal(surface(x, z), T.PATH, 'Windmill walking trail disconnected');
  }
  assert.equal(surface(FIELD.x0 + 0.7, -7), T.SOIL, 'Field must retain planted soil');
  assert.equal(qa.windmillDoorOpen, true, 'Windmill entry must be a real opening');
  const rotorToTowerFace = 0.5 / V + forward - axleDepth / 2;
  for (let degrees = 0; degrees < 360; degrees += 15) {
    // z remains invariant when rotating around z with yaw 0.
    assert.ok(rotorToTowerFace > 0.12,
      'Windmill rotor may intersect the tower at angle ' + degrees);
  }
  assert.ok(world.windmill && world.windmill.hub.z > -27.5,
    'Windmill blades must hang outside the front wall');
  // Both banks should transition through wet sand, dry sand and grass, not a constant paved rim.
  const shore = { wet: 0, sand: 0, grass: 0 };
  for (let x = -19; x <= 20; x++) for (let d = 2.4; d <= 4.1; d += .22) {
    for (const bank of [-1, 1]) {
      const material = surface(x, riverZ(x) + bank * d);
      if (material === T.WETSAND) shore.wet++;
      else if (material === T.SAND) shore.sand++;
      else if (material === T.GRASS) shore.grass++;
    }
  }
  assert.ok(shore.wet > 5 && shore.sand > 5 && shore.grass > 5,
    'Creek shoreline must include wet/dry/vegetated transitions');
  for (const x of [-8, -6, -4, -2, 0, 2, 4]) {
    const t = (x - HUT.doorX) / (TREE.x - 1.25 - HUT.doorX);
    const z = HUT.z1 + 1.82 + 2.24 * Math.pow(t, 0.82) + 0.16 * Math.sin(t * Math.PI);
    const y = Math.round(world.getH(x, z) * V);
    assert.equal(gridCell(Math.round(x * V), y, Math.round(z * V)), T.PATH,
      'Side path is interrupted at x=' + x);
  }
  assert.ok(world.courtyardShrubs.length >= 3, 'Yard requires modest low planting');
  const benchX = Math.round(world.bench.x * V), benchZ = Math.round(world.bench.z * V);
  const benchY = Math.round(world.getH(world.bench.x, world.bench.z) * V) +
    Math.max(2, Math.round(0.75 * V));
  const benchHalf = Math.max(1, Math.round(0.85 * V));
  const benchBackZ = benchZ - Math.max(1, Math.round(0.3 * V));
  const benchBackTop = benchY + Math.max(2, Math.round(0.7 * V));
  assert.equal(gridCell(benchX, benchY, benchZ), T.PLANK,
    'Yard bench seat must be intact and off the walking route');
  for (const dx of [-benchHalf, benchHalf]) {
    assert.equal(gridCell(benchX + dx, benchY - 1, benchZ), T.LOG,
      'Bench leg must physically support seat instead of floating');
    assert.equal(gridCell(benchX + dx, benchBackTop, benchBackZ), T.PLANK,
      'Bench backrest must be connected to a support');
  }
  for (const z of [-8, -7, -6, -5]) {
    const x = HUT.doorX;
    const y = Math.round(world.getH(x, z) * V);
    assert.equal(gridCell(Math.round(x * V), y, Math.round(z * V)), T.PATH,
      'Bridge walkway disconnected at z=' + z);
  }
  assert.equal(qa.forestGroundRootMode, 'minimal-ground-collar',
    'Forest trees must use ground-rooted slender trunk bases');
  const shapes = Object.fromEntries(Object.entries(qa.forestShapeCounts));
  assert.equal(qa.forestGroundedCount, Object.values(shapes).reduce((sum, n) => sum + n, 0),
    'Every forest tree must have an actual rooted stem at ground level');
  assert.equal(qa.forestPedestalViolations, 0,
    'Forest must not contain raised 3x3 cuboid trunk pedestals');
  for (const species of ['round', 'tall', 'spreading', 'pine']) {
    assert.ok(shapes[species] > 0, 'Distinct forest silhouette missing: ' + species);
  }
  // The cottage eaves must exist and remain symmetric on both roof ends.
  const hx0 = Math.round(HUT.x0 * V), hx1 = Math.round(HUT.x1 * V);
  const hz1 = Math.round(HUT.z1 * V);
  const roofY = 2 + 3 * V;
  const overhang = Math.max(1, Math.round(V * 0.67));
  assert.equal(gridCell(hx0, roofY - 1, hz1 + overhang), T.LOG, 'Left fascia missing');
  assert.equal(gridCell(hx1, roofY - 1, hz1 + overhang), T.LOG, 'Right fascia missing');
  // The hero tree keeps actual trunk material at its original root coordinates.
  const tx = Math.round(TREE.x * V), tz = Math.round(TREE.z * V);
  assert.equal(gridCell(tx, V, tz), T.TLOG, 'Hero trunk must stay grounded');
  assert.ok(world.fruitSpots.length >= 5, 'Existing jujube fruit interaction needs fruit anchors');
  assert.ok(world.flowerSpots.length >= 10, 'Existing blossom interaction needs blossom anchors');
  process.stdout.write('PASS Natume V3.2 ' + (touch ? 'mobile' : 'desktop') +
    ' V=' + V + ' trees=' + JSON.stringify(shapes) + '\n');

  function gridCell(x, y, z) { return world.grid.get(x, y, z); }
  function surface(x, z) {
    return gridCell(Math.round(x * V), Math.round(world.getH(x, z) * V), Math.round(z * V));
  }
}
