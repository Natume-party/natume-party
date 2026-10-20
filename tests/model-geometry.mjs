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
  runInNewContext(generator + '\nglobalThis.testWorld = { V, generateWorld };', scope);
  const { V, generateWorld } = scope.testWorld;
  assert.equal(V, touch ? 2 : 3, 'Voxel density mismatches test device');
  const { modelQA: qa } = generateWorld();
  assert.equal(qa.doorCenterError, 0, 'Door must be centered');
  assert.equal(qa.frontWindowMirrorError, 0, 'Front windows must mirror');
  assert.equal(qa.sideWindowAlignError, 0, 'Side windows must align');
  assert.deepEqual(Array.from(qa.windowObstructions), [0, 0, 0, 0], 'Openings cannot be covered by timber');
  assert.equal(qa.totalWindowObstructions, 0, 'No window may contain an occluding voxel');
  assert.ok(Number.isFinite(qa.treeCanopyTop), 'Canopy must have a finite top');
  process.stdout.write('PASS Natume V3.2 ' + (touch ? 'mobile' : 'desktop') + ' V=' + V + '\n');
}
