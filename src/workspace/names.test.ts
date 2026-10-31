import { describe, test } from 'node:test';
import assert from 'node:assert';
import { fileNameFor, nameFromFileName, uniqueName } from './names.ts';

describe('uniqueName', () => {
  test('uses the base name when it is free', () => {
    assert.strictEqual(uniqueName('Untitled', ['Other']), 'Untitled');
  });

  test('appends the lowest free number', () => {
    assert.strictEqual(
      uniqueName('Untitled', ['Untitled', 'Untitled 2']),
      'Untitled 3'
    );
    assert.strictEqual(
      uniqueName('Untitled', ['Untitled', 'Untitled 3']),
      'Untitled 2'
    );
  });

  test('compares case-insensitively and ignores surrounding space', () => {
    assert.strictEqual(uniqueName(' notes ', ['Notes']), 'notes 2');
  });

  test('an empty base becomes Untitled', () => {
    assert.strictEqual(uniqueName('   ', []), 'Untitled');
  });
});

describe('fileNameFor', () => {
  test('slugifies the document name into a .tex file name', () => {
    assert.strictEqual(fileNameFor('A Short Example'), 'a-short-example.tex');
    assert.strictEqual(
      fileNameFor('Énergie & Systems: 1996!'),
      'energie-systems-1996.tex'
    );
  });

  test('falls back to article.tex when nothing usable remains', () => {
    assert.strictEqual(fileNameFor('!!!'), 'article.tex');
    assert.strictEqual(fileNameFor(''), 'article.tex');
  });

  test('can use another extension', () => {
    assert.strictEqual(fileNameFor('Refs', '.bib'), 'refs.bib');
  });
});

describe('nameFromFileName', () => {
  test('strips the extension and path', () => {
    assert.strictEqual(nameFromFileName('paper.tex'), 'paper');
    assert.strictEqual(nameFromFileName('C:\\x\\My Draft.TEX'), 'My Draft');
  });

  test('turns slugs back into readable names', () => {
    assert.strictEqual(
      nameFromFileName('energy_systems-draft.tex'),
      'energy systems draft'
    );
  });

  test('empty names become Untitled', () => {
    assert.strictEqual(nameFromFileName('.tex'), 'Untitled');
  });
});
