import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSSE } from '../src/api.js';

const ev = (o) => `data: ${JSON.stringify(o)}`;

test('LF and CRLF event separators both parse', () => {
  assert.deepEqual(parseSSE(`${ev({ a: 1 })}\n\n`).events, [{ a: 1 }]);
  assert.deepEqual(parseSSE(`${ev({ a: 1 })}\r\n\r\n`).events, [{ a: 1 }]);
});

test('a partial event stays in rest until its terminator arrives', () => {
  const { events, rest } = parseSSE(`${ev({ a: 1 })}\n\ndata: {"b":`);
  assert.deepEqual(events, [{ a: 1 }]);
  assert.equal(rest, 'data: {"b":');
  assert.deepEqual(parseSSE(`${rest}2}\n\n`).events, [{ b: 2 }]);
});

test('multi-line data joins with \\n; comments and [DONE] are skipped', () => {
  const { events } = parseSSE(`: keep-alive\n\ndata: {"a":\ndata: 1}\n\ndata: [DONE]\n\n`);
  assert.deepEqual(events, [{ a: 1 }]);
});
