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
  const { modelQA: qa } = generateWorld();
  assert.equal(qa.doorCenterError, 0, 'Door must be centered');
  assert.equal(qa.frontWindowMirrorError, 0, 'Front windows must mirror');
  assert.equal(qa.sideWindowAlignError, 0, 'Side windows must align');
  assert.deepEqual(Array.from(qa.windowObstructions), [0, 0, 0, 0], 'Openings cannot be covered by timber');
  assert.equal(qa.totalWindowObstructions, 0, 'No window may contain an occluding voxel');
  assert.ok(Number.isFinite(qa.treeCanopyTop), 'Canopy must have a finite top');
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
