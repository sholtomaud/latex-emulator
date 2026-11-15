import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FolderSync,
  MemoryFolderLinks,
  unsupportedMessage,
} from './folder-sync.ts';
import type { FolderState } from './folder-sync.ts';
import { FakeDir, FakeFile } from '../test-support/fake-directory.ts';
import type { DirectoryHandle } from './fs-access.ts';
import type { Project } from './project.ts';

const text = (s: string) => new TextEncoder().encode(s);
const read = (dir: FakeDir, name: string) =>
  new TextDecoder().decode((dir.entriesMap.get(name) as FakeFile).bytes);

function project(source: string): Project {
  return {
    folder: 'a-short-example',
    fileName: 'a-short-example.zip',
    files: [
      { path: 'a-short-example/a-short-example.tex', bytes: text(source) },
    ],
    missingBibs: [],
  };
}

function setup(o: { pick?: DirectoryHandle | null; supported?: boolean } = {}) {
  const parent = new FakeDir('Papers');
  const links = new MemoryFolderLinks();
  const states: FolderState[] = [];
  let picks = 0;
  let clock = 1000;
  const sync = new FolderSync(links, {
    supported: o.supported ?? true,
    pick: async () => {
      picks++;
      return o.pick === undefined ? parent : o.pick;
    },
    now: () => ++clock,
    publish: (s) => states.push(s),
  });
  return {
    sync,
    parent,
    links,
    states,
    last: () => states.at(-1)!,
    picks: () => picks,
  };
}

const folder = (parent: FakeDir) =>
  parent.entriesMap.get('a-short-example') as FakeDir;

describe('FolderSync', () => {
  test('a document with no folder says so', async () => {
    const { sync, last } = setup();
    await sync.open('doc-1');
    assert.deepEqual(last(), {
      supported: true,
      documentId: 'doc-1',
      link: null,
      permission: null,
      conflicts: [],
      status: '',
    });
  });

  test('the first save asks for a folder and creates the project folder in it', async () => {
    const { sync, parent, last, picks } = setup();
    await sync.open('doc-1');
    await sync.save(project('v1'));
    assert.equal(picks(), 1);
    assert.equal(read(folder(parent), 'a-short-example.tex'), 'v1');
    assert.deepEqual(last().link, {
      folderName: 'a-short-example',
      parentName: 'Papers',
      savedAt: 1001,
      auto: false,
    });
    assert.equal(last().permission, 'granted');
    assert.equal(
      last().status,
      'Saved to a-short-example/ in “Papers”: 1 file written.'
    );

    // Later saves go to the same folder without asking.
    await sync.save(project('v2'));
    assert.equal(picks(), 1);
    assert.equal(read(folder(parent), 'a-short-example.tex'), 'v2');
    await sync.save(project('v2'));
    assert.equal(
      last().status,
      'Saved to a-short-example/ in “Papers”: nothing had changed.'
    );
  });

  test('cancelling the folder picker changes nothing', async () => {
    const { sync, last } = setup({ pick: null });
    await sync.open('doc-1');
    await sync.save(project('v1'));
    assert.equal(last().link, null);
    assert.equal(last().status, '');
  });

  test('a file changed in the folder is a conflict until the user overwrites it', async () => {
    const { sync, parent, last } = setup();
    await sync.open('doc-1');
    await sync.save(project('v1'));
    const f = folder(parent).entriesMap.get('a-short-example.tex') as FakeFile;
    f.bytes = text('edited elsewhere');
    await sync.save(project('v2'));
    assert.deepEqual(last().conflicts, ['a-short-example.tex']);
    assert.equal(
      last().status,
      'a-short-example.tex changed in the folder since the last save. Overwrite it, or cancel and keep the folder’s copy.'
    );
    assert.equal(
      read(folder(parent), 'a-short-example.tex'),
      'edited elsewhere'
    );
    await sync.save(project('v2'), { overwrite: true });
    assert.deepEqual(last().conflicts, []);
    assert.equal(read(folder(parent), 'a-short-example.tex'), 'v2');
  });

  test('cancel clears a conflict', async () => {
    const { sync, parent, last } = setup();
    await sync.open('doc-1');
    await sync.save(project('v1'));
    (folder(parent).entriesMap.get('a-short-example.tex') as FakeFile).bytes =
      text('x');
    await sync.save(project('v2'));
    sync.cancel();
    assert.deepEqual(last().conflicts, []);
    assert.equal(last().status, 'Not saved: the folder keeps its copy.');
  });

  test('links are per document and survive a reload', async () => {
    const { sync, links, last } = setup();
    await sync.open('doc-1');
    await sync.save(project('v1'));
    await sync.open('doc-2');
    assert.equal(last().link, null);
    const states: FolderState[] = [];
    const again = new FolderSync(links, {
      supported: true,
      pick: async () => null,
      now: () => 5000,
      publish: (s) => states.push(s),
    });
    await again.open('doc-1');
    assert.equal(states.at(-1)!.link?.folderName, 'a-short-example');
  });

  test('after a reload, saving asks for permission again (in the click)', async () => {
    const { sync, parent, last } = setup();
    await sync.open('doc-1');
    await sync.save(project('v1'));
    const dir = folder(parent);
    dir.state = 'prompt';
    await sync.open('doc-1');
    assert.equal(last().permission, 'prompt');
    await sync.save(project('v2'));
    assert.equal(dir.asked, 1);
    assert.equal(read(dir, 'a-short-example.tex'), 'v2');
  });

  test('refused permission writes nothing and says why', async () => {
    const { sync, parent, last } = setup();
    await sync.open('doc-1');
    await sync.save(project('v1'));
    const dir = folder(parent);
    dir.state = 'denied';
    dir.requestPermission = async () => 'denied';
    await sync.save(project('v2'));
    assert.equal(read(dir, 'a-short-example.tex'), 'v1');
    assert.equal(
      last().status,
      'The browser didn’t allow saving to that folder.'
    );
  });

  test('automatic saving: off by default, only with permission, paused by a conflict', async () => {
    const { sync, parent, last } = setup();
    await sync.open('doc-1');
    // No folder yet: nothing to do.
    await sync.autoSave(project('v0'));
    assert.equal(last().link, null);

    await sync.save(project('v1'));
    await sync.autoSave(project('v2'));
    assert.equal(read(folder(parent), 'a-short-example.tex'), 'v1');

    assert.equal(sync.wantsAutoSave(), false);
    await sync.setAuto(true);
    assert.equal(last().link?.auto, true);
    assert.equal(sync.wantsAutoSave(), true);
    await sync.autoSave(project('v3'));
    assert.equal(read(folder(parent), 'a-short-example.tex'), 'v3');

    // Never prompts on its own: without permission it waits for a click.
    folder(parent).state = 'prompt';
    await sync.autoSave(project('v4'));
    assert.equal(folder(parent).asked, 0);
    assert.equal(read(folder(parent), 'a-short-example.tex'), 'v3');
    folder(parent).state = 'granted';

    (folder(parent).entriesMap.get('a-short-example.tex') as FakeFile).bytes =
      text('edited elsewhere');
    await sync.autoSave(project('v5'));
    assert.deepEqual(last().conflicts, ['a-short-example.tex']);
    assert.equal(
      read(folder(parent), 'a-short-example.tex'),
      'edited elsewhere'
    );
  });

  test('linking an opened folder, and forgetting a folder', async () => {
    const { sync, last, links } = setup();
    const dir = new FakeDir('thesis');
    await sync.open('doc-9');
    await sync.link('doc-9', dir, {
      texPath: 'main.tex',
      saved: { 'main.tex': 'abc' },
    });
    assert.deepEqual(last().link, {
      folderName: 'thesis',
      parentName: null,
      savedAt: 1001,
      auto: false,
    });
    // Saves keep the folder's own .tex name.
    await sync.save(project('body'));
    assert.equal(read(dir, 'main.tex'), 'body');
    assert.equal(dir.entriesMap.has('a-short-example.tex'), false);

    await sync.unlink();
    assert.equal(last().link, null);
    assert.equal(await links.get('doc-9'), undefined);
  });

  test('an open() that finishes late does not undo a link or a message', async () => {
    const { sync, links, last } = setup();
    // The link store answers slowly, as IndexedDB can.
    const get = links.get.bind(links);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    links.get = async (id) => {
      const r = await get(id);
      await gate;
      return r;
    };
    const late = sync.open('doc-1'); // reads "no link" before link() runs
    links.get = get;
    await sync.link('doc-1', new FakeDir('thesis'), {
      texPath: 'main.tex',
      saved: {},
    });
    sync.say('Opened main.tex from thesis/.');
    release();
    await late;
    assert.equal(last().link?.folderName, 'thesis');
    assert.equal(last().status, 'Opened main.tex from thesis/.');
  });

  test('edge cases: no folder to switch, a permission check that throws, cancel with nothing pending', async () => {
    const { sync, parent, last, states } = setup();
    await sync.open('doc-1');
    const before = states.length;
    await sync.setAuto(true);
    await sync.unlink();
    sync.cancel();
    assert.equal(states.length, before);

    await sync.save(project('v1'));
    await sync.setAuto(true);
    folder(parent).queryPermission = async () => {
      throw new Error('handle gone');
    };
    await sync.autoSave(project('v2'));
    assert.equal(last().status, 'Saving to the folder failed: handle gone');
  });

  test('without the File System Access API there is nothing to save to', async () => {
    const { sync, last, picks } = setup({ supported: false });
    await sync.open('doc-1');
    await sync.save(project('v1'));
    assert.equal(picks(), 0);
    assert.equal(last().supported, false);
  });

  test('a failing write is reported', async () => {
    const { sync, parent, last } = setup();
    await sync.open('doc-1');
    await sync.save(project('v1'));
    folder(parent).getFileHandle = async () => {
      throw new DOMException('disk full', 'QuotaExceededError');
    };
    await sync.save(project('v2'));
    assert.equal(last().status, 'Saving to the folder failed: disk full');
  });
});

describe('unsupportedMessage', () => {
  test('Brave has the API but blocks it unless the user turns it on', () => {
    assert.equal(
      unsupportedMessage({ brave: true }),
      'Brave blocks saving to folders by default. On desktop you can turn it on in brave://flags (search for “File System Access”), then reload. Until then, use Download .zip.'
    );
  });

  test('other browsers: Chrome, Edge or Brave', () => {
    assert.equal(
      unsupportedMessage({ brave: false }),
      'Saving to a folder needs Chrome, Edge or Brave (with its flag on). Use Download .zip instead.'
    );
  });
});
