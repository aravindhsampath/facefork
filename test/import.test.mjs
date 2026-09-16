import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { importTree } from '../src/share.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const node = (id, parents = [], extra = {}) => ({ id, parents, prompt: `p${id}`, w: 4, h: 6, status: 'ready', image: `img/${id}.jpg`, ...extra });
const pack = (nodes, files = {}, graph = {}) => {
  const entries = { 'graph.json': strToU8(JSON.stringify({ format: 'facefork', version: 1, nodes, ...graph })) };
  for (const n of nodes) if (n.image && !(n.image in files)) entries[n.image] = JPEG;
  Object.assign(entries, files);
  return new Blob([zipSync(entries)]);
};
const rejects = (p, re) => assert.rejects(p, (e) => re.test(e.message) || assert.fail(`unexpected: ${e.message}`));

test('a sound tree imports with fresh ids and mapped parents', async () => {
  const recs = await importTree(pack([node('a'), node('b', ['a']), node('c', ['a', 'b'], { image: 'img/c.png' })], { 'img/c.png': PNG }));
  assert.equal(recs.length, 3);
  assert.notEqual(recs[0].id, 'a');
  assert.deepEqual(recs[2].parents, [recs[0].id, recs[1].id]);
  assert.equal(recs[2].blob.type, 'image/png');
  assert.equal(recs[0].inline, undefined);
});

test('cycles are rejected', () => rejects(importTree(pack([node('a', ['b']), node('b', ['a'])])), /loops/));
test('a node that is its own parent is rejected', () => rejects(importTree(pack([node('a', ['a'])])), /loops/));
test('duplicate ids are rejected', () => rejects(importTree(pack([node('a'), node('a')])), /duplicate/));
test('zero or negative sizes are rejected', () => rejects(importTree(pack([node('a', [], { w: 0, h: -1 })])), /size/));
test('a newer version is rejected', () => rejects(importTree(pack([node('a')], {}, { version: 999 })), /version 999/));
test('ready without image bytes is rejected', () => rejects(importTree(pack([node('a', [], { image: undefined })])), /no image/));
test('a parent missing from the file is rejected', () => rejects(importTree(pack([node('a', ['ghost'])])), /not in the file/));
test('image entries must be real JPEG/PNG/WebP', () => rejects(importTree(pack([node('a')], { 'img/a.jpg': strToU8('<html>') })), /not a JPEG/));
test('unknown statuses are rejected', () => rejects(importTree(pack([node('a', [], { status: 'weird' })])), /status/));
test('not a zip at all', () => rejects(importTree(new Blob([strToU8('nope')])), /./));
