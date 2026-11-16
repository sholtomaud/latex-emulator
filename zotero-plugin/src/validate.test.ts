import { test } from 'node:test';
import assert from 'node:assert';
import { validate } from './validate.ts';
import type { Schema } from './validate.ts';

const schema: Schema = {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 5 },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    key: { type: 'string', pattern: '^[A-Z0-9]{8}$' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['query'],
  additionalProperties: false,
};

test('accepts arguments that match, with optional ones left out', () => {
  assert.deepStrictEqual(validate(schema, { query: 'abc' }), []);
  assert.deepStrictEqual(
    validate(schema, {
      query: 'abc',
      limit: 3,
      key: 'ABCD1234',
      tags: ['x'],
    }),
    []
  );
});

test('says what is wrong, naming the argument', () => {
  assert.deepStrictEqual(validate(schema, {}), ['query is required']);
  assert.deepStrictEqual(validate(schema, { query: '' }), [
    'query must be at least 1 characters',
  ]);
  assert.deepStrictEqual(validate(schema, { query: 'abcdef' }), [
    'query must be at most 5 characters',
  ]);
  assert.deepStrictEqual(validate(schema, { query: 'a', limit: 0 }), [
    'limit must be at least 1',
  ]);
  assert.deepStrictEqual(validate(schema, { query: 'a', limit: 51 }), [
    'limit must be at most 50',
  ]);
  assert.deepStrictEqual(validate(schema, { query: 'a', limit: 1.5 }), [
    'limit must be an integer',
  ]);
  assert.deepStrictEqual(validate(schema, { query: 7 }), [
    'query must be a string',
  ]);
  assert.deepStrictEqual(validate(schema, { query: 'a', key: 'abc' }), [
    'key is not in the expected form',
  ]);
  assert.deepStrictEqual(validate(schema, { query: 'a', tags: ['x', 2] }), [
    'tags[1] must be a string',
  ]);
  assert.deepStrictEqual(validate(schema, { query: 'a', tags: 'x' }), [
    'tags must be an array',
  ]);
  assert.deepStrictEqual(validate(schema, { query: 'a', extra: 1 }), [
    'extra is not a known argument',
  ]);
});

test('arguments must be an object', () => {
  for (const args of [null, [], 'q', undefined])
    assert.deepStrictEqual(validate(schema, args), [
      'arguments must be an object',
    ]);
});

test('nested objects and non-object schemas are checked too', () => {
  const nested: Schema = {
    type: 'object',
    properties: {
      range: {
        type: 'object',
        properties: { from: { type: 'integer' } },
        required: ['from'],
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };
  assert.deepStrictEqual(validate(nested, { range: {} }), ['from is required']);
  assert.deepStrictEqual(validate({ type: 'string' }, 3), [
    'value must be a string',
  ]);
});

test('booleans must be true or false', () => {
  const flag: Schema = {
    type: 'object',
    properties: { on: { type: 'boolean' } },
    additionalProperties: false,
  };
  assert.deepStrictEqual(validate(flag, { on: true }), []);
  assert.deepStrictEqual(validate(flag, { on: 'yes' }), [
    'on must be true or false',
  ]);
});
