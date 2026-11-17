import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { callLine, resultLine } from './tool-lines.ts';

describe('tool lines in the conversation', () => {
  test('a call: its name and short arguments', () => {
    assert.equal(
      callLine({
        id: 'c',
        name: 'zettel_create',
        input: {
          title: 'Energy is the currency of systems',
          sources: ['ABCD2345'],
        },
      }),
      'zettel_create(title: “Energy is the currency of systems”, sources: [“ABCD2345”])'
    );
    assert.equal(
      callLine({ id: 'c', name: 'comments_list', input: {} }),
      'comments_list()'
    );
    assert.match(
      callLine({
        id: 'c',
        name: 'comment_add',
        input: { text: 'x'.repeat(200) },
      }),
      /^comment_add\(text: “x+…”\)$/
    );
  });

  test('a result: what came back, cut short; an error says so', () => {
    assert.equal(
      resultLine({
        role: 'tool',
        callId: 'c',
        name: 'zettel_create',
        content: '{"zettel":{"id":"1a"}}',
      }),
      '→ {"zettel":{"id":"1a"}}'
    );
    assert.equal(
      resultLine({
        role: 'tool',
        callId: 'c',
        name: 'zettel_get',
        content: 'No zettel 9.',
        isError: true,
      }),
      '✗ No zettel 9.'
    );
    assert.equal(
      resultLine({
        role: 'tool',
        callId: 'c',
        name: 'document_read',
        content: 'a'.repeat(500),
      }).length,
      // "→ ", 160 characters and "…"
      163
    );
  });
});
