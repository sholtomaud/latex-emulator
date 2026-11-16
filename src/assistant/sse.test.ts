import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SseParser } from './sse.ts';

describe('SseParser', () => {
  test('events split across chunks are joined; comments and event names are skipped', () => {
    const p = new SseParser();
    assert.deepEqual(p.push('event: content_block_delta\ndata: {"a"'), []);
    assert.deepEqual(
      p.push(':1}\n\n: OPENROUTER PROCESSING\n\ndata: x\r\n\r\n'),
      ['{"a":1}', 'x']
    );
  });

  test('multi-line data is joined with newlines; a final event without a blank line is flushed', () => {
    const p = new SseParser();
    assert.deepEqual(p.push('data: one\ndata:two\n\ndata: tail'), ['one\ntwo']);
    assert.deepEqual(p.flush(), ['tail']);
    assert.deepEqual(p.flush(), []);
  });
});
