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
const generator = source.slice(0, boundary)
  .replace(/^import \* as THREE from 'three';\s*/m, '')
  .replace(/\bexport (?=(const|function|class)\b)/g, '');

for (const touch of [true, false]) {
  const scope = {
    matchMedia: (query) => ({ matches: touch && query === '(pointer: coarse)' }),
  };
  runInNewContext(generator + '\nglobalThis.testWorld = { V, generateWorld, T, HUT, TREE };', scope);
  const { V, generateWorld, T, HUT, TREE } = scope.testWorld;
  assert.equal(V, touch ? 2 : 3, 'Voxel density mismatches test device');
  const world = generateWorld();
  const { modelQA: qa } = world;
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
    Math.max(1, Math.round(0.48 * V));
  assert.equal(gridCell(benchX, benchY, benchZ), T.PLANK,
    'Yard bench should be intact and off the walking route');
  for (const z of [-8, -7, -6, -5]) {
    const x = HUT.doorX;
    const y = Math.round(world.getH(x, z) * V);
    assert.equal(gridCell(Math.round(x * V), y, Math.round(z * V)), T.PATH,
      'Bridge walkway disconnected at z=' + z);
  }
  const shapes = Object.fromEntries(Object.entries(qa.forestShapeCounts));
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
}
