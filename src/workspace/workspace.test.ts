import { describe, test } from 'node:test';
import assert from 'node:assert';
import { Workspace, NEW_DOCUMENT_SOURCE } from './workspace.ts';
import type { WorkspaceState } from './workspace.ts';
import { MemoryRepository } from '../storage/memory-repository.ts';

function setup(
  options: { repo?: MemoryRepository; activeId?: string | null } = {}
) {
  const repo = options.repo ?? new MemoryRepository();
  let clock = 1000;
  let ids = 0;
  let activeId = options.activeId ?? null;
  const states: WorkspaceState[] = [];
  const workspace = new Workspace(repo, {
    now: () => ++clock,
    newId: () => `doc-${++ids}`,
    prefs: {
      getActiveId: () => activeId,
      setActiveId: (id) => (activeId = id),
    },
    publish: (s) => states.push(s),
  });
  return {
    repo,
    workspace,
    states,
    last: () => states.at(-1)!,
    active: () => activeId,
  };
}

const SAMPLE = { name: 'A Short Example', source: '\\title{A Short Example}' };

describe('Workspace', () => {
  test('first run creates and opens the sample document', async () => {
    const { workspace, last, repo } = setup();
    await workspace.init(SAMPLE);
    assert.strictEqual(last().documents.length, 1);
    assert.strictEqual(last().documents[0].name, 'A Short Example');
    assert.strictEqual(last().activeId, 'doc-1');
    assert.strictEqual(last().activeSource, SAMPLE.source);
    assert.strictEqual((await repo.list()).length, 1);
  });

  test('later runs reopen the remembered document', async () => {
    const repo = new MemoryRepository();
    await repo.put({
      id: 'x',
      name: 'X',
      source: 'x',
      createdAt: 1,
      updatedAt: 5,
    });
    await repo.put({
      id: 'y',
      name: 'Y',
      source: 'y',
      createdAt: 1,
      updatedAt: 9,
    });
    const { workspace, last } = setup({ repo, activeId: 'x' });
    await workspace.init(SAMPLE);
    assert.strictEqual(last().activeId, 'x');
    assert.strictEqual(last().activeSource, 'x');
  });

  test('without a remembered document, the most recently edited one opens', async () => {
    const repo = new MemoryRepository();
    await repo.put({
      id: 'x',
      name: 'X',
      source: 'x',
      createdAt: 1,
      updatedAt: 5,
    });
    await repo.put({
      id: 'y',
      name: 'Y',
      source: 'y',
      createdAt: 1,
      updatedAt: 9,
    });
    const { workspace, last } = setup({ repo, activeId: 'gone' });
    await workspace.init(SAMPLE);
    assert.strictEqual(last().activeId, 'y');
  });

  test('documents are listed most recently edited first', async () => {
    const { workspace, last } = setup();
    await workspace.init(SAMPLE);
    await workspace.create();
    await workspace.open('doc-1');
    await workspace.save('edited');
    assert.deepStrictEqual(
      last().documents.map((d) => d.id),
      ['doc-1', 'doc-2']
    );
  });

  test('create makes a uniquely named document from the template and opens it', async () => {
    const { workspace, last, active } = setup();
    await workspace.init(SAMPLE);
    await workspace.create();
    await workspace.create();
    assert.deepStrictEqual(
      last()
        .documents.map((d) => d.name)
        .sort(),
      ['A Short Example', 'Untitled', 'Untitled 2']
    );
    assert.strictEqual(last().activeSource, NEW_DOCUMENT_SOURCE);
    assert.strictEqual(active(), last().activeId);
  });

  test('save updates the active document; saving unchanged text is a no-op', async () => {
    const { workspace, repo, states } = setup();
    await workspace.init(SAMPLE);
    await workspace.save('new text');
    assert.strictEqual((await repo.get('doc-1'))!.source, 'new text');
    const count = states.length;
    await workspace.save('new text');
    assert.strictEqual(states.length, count);
  });

  test('rename trims, keeps names unique, and ignores empty names', async () => {
    const { workspace, last } = setup();
    await workspace.init(SAMPLE);
    await workspace.create();
    await workspace.rename('doc-2', '  A Short Example ');
    assert.strictEqual(
      last().documents.find((d) => d.id === 'doc-2')!.name,
      'A Short Example 2'
    );
    await workspace.rename('doc-2', '   ');
    assert.strictEqual(
      last().documents.find((d) => d.id === 'doc-2')!.name,
      'A Short Example 2'
    );
    await workspace.rename('doc-2', 'Paper');
    assert.strictEqual(
      last().documents.find((d) => d.id === 'doc-2')!.name,
      'Paper'
    );
  });

  test('renaming to its own name (any case) keeps it', async () => {
    const { workspace, last } = setup();
    await workspace.init(SAMPLE);
    await workspace.rename('doc-1', 'a short example');
    assert.strictEqual(last().documents[0].name, 'a short example');
  });

  test('deleting the open document opens the next most recent one', async () => {
    const { workspace, last } = setup();
    await workspace.init(SAMPLE);
    await workspace.create();
    await workspace.delete('doc-2');
    assert.deepStrictEqual(
      last().documents.map((d) => d.id),
      ['doc-1']
    );
    assert.strictEqual(last().activeId, 'doc-1');
  });

  test('deleting the last document leaves a fresh Untitled one', async () => {
    const { workspace, last } = setup();
    await workspace.init(SAMPLE);
    await workspace.delete('doc-1');
    assert.strictEqual(last().documents.length, 1);
    assert.strictEqual(last().documents[0].name, 'Untitled');
    assert.strictEqual(last().activeSource, NEW_DOCUMENT_SOURCE);
  });

  test('deleting another document keeps the open one', async () => {
    const { workspace, last } = setup();
    await workspace.init(SAMPLE);
    await workspace.create();
    await workspace.delete('doc-1');
    assert.strictEqual(last().activeId, 'doc-2');
  });

  test('import creates a document named after the file', async () => {
    const { workspace, last } = setup();
    await workspace.init(SAMPLE);
    await workspace.importFile('my_paper.tex', '\\section{X}');
    assert.strictEqual(last().activeSource, '\\section{X}');
    assert.ok(last().documents.some((d) => d.name === 'my paper'));
  });

  test('exportActive gives the file name and exact source', async () => {
    const { workspace } = setup();
    await workspace.init(SAMPLE);
    assert.deepStrictEqual(workspace.exportActive(), {
      fileName: 'a-short-example.tex',
      text: SAMPLE.source,
    });
  });

  test('exportDocument exports any document by id', async () => {
    const { workspace } = setup();
    await workspace.init(SAMPLE);
    await workspace.create();
    assert.deepStrictEqual(workspace.exportDocument('doc-1'), {
      fileName: 'a-short-example.tex',
      text: SAMPLE.source,
    });
    assert.strictEqual(workspace.exportDocument('nope'), null);
  });

  test('opening an unknown id changes nothing', async () => {
    const { workspace, last } = setup();
    await workspace.init(SAMPLE);
    await workspace.open('nope');
    assert.strictEqual(last().activeId, 'doc-1');
  });

  test('operations on unknown ids are ignored', async () => {
    const { workspace, last } = setup();
    await workspace.init(SAMPLE);
    await workspace.rename('nope', 'x');
    await workspace.delete('nope');
    assert.strictEqual(last().documents.length, 1);
  });

  test('the new-document template is a valid article skeleton', () => {
    assert.match(
      NEW_DOCUMENT_SOURCE,
      /\\documentclass\[11pt,a4paper\]\{article\}/
    );
    assert.match(
      NEW_DOCUMENT_SOURCE,
      /\\begin\{document\}[\s\S]*\\end\{document\}/
    );
  });
});
