import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  BACKUP_FORMAT,
  backupFileName,
  backupFiles,
  planRestore,
  readBackup,
  restoreSummary,
} from './backup.ts';
import type { WorkspaceSnapshot, CurrentWorkspace } from './backup.ts';
import type { ZipFile } from '../util/zip.ts';

const sha = (b: Uint8Array | string) =>
  createHash('sha256').update(b).digest('hex');
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0, 2, 0, 0, 0, 3, 8, 2, 0, 0, 0, 0, 0, 0, 0,
]);
const PNG_SHA = sha(PNG);

function snapshot(): WorkspaceSnapshot {
  return {
    documents: [
      { id: 'd1', name: 'Paper', source: 'one', createdAt: 1, updatedAt: 10 },
      { id: 'd2', name: 'Notes', source: 'two', createdAt: 2, updatedAt: 20 },
    ],
    versions: [
      {
        id: 'v1',
        documentId: 'd1',
        version: '0.1.0',
        createdAt: 5,
        sha256: sha('one'),
        source: 'one',
      },
    ],
    bibFiles: [{ name: 'references', source: '@misc{a,}', updatedAt: 3 }],
    images: [
      {
        id: 'd1/figs/plot.png',
        documentId: 'd1',
        name: 'figs/plot.png',
        sha256: PNG_SHA,
        updatedAt: 4,
      },
    ],
    blobs: [{ sha256: PNG_SHA, bytes: PNG }],
  };
}

const CREATED = Date.UTC(2026, 10, 15, 9, 30);
const json = (files: ZipFile[]) =>
  JSON.parse(
    new TextDecoder().decode(
      files.find((f) => f.path === 'workspace.json')!.bytes
    )
  );

describe('backupFiles', () => {
  test('writes workspace.json, the image bytes by hash, and readable copies', () => {
    const files = backupFiles(snapshot(), CREATED);
    assert.deepEqual(
      files.map((f) => f.path),
      [
        'workspace.json',
        `blobs/${PNG_SHA}`,
        'documents/paper.tex',
        'documents/notes.tex',
        'bibliography/references.bib',
      ]
    );
    const manifest = json(files);
    assert.equal(manifest.format, BACKUP_FORMAT);
    assert.equal(manifest.version, 1);
    assert.equal(manifest.createdAt, CREATED);
    assert.equal(manifest.documents[0].source, 'one');
    assert.deepEqual(manifest.blobs, [PNG_SHA]);
  });

  test('readable copies get unique names', () => {
    const s = snapshot();
    s.documents[1].name = 'paper';
    const paths = backupFiles(s, CREATED).map((f) => f.path);
    assert.ok(paths.includes('documents/paper.tex'));
    assert.ok(paths.includes('documents/paper-2.tex'));
  });

  test('the file name carries the date', () => {
    assert.equal(
      backupFileName(new Date(2026, 10, 5)),
      'latex-emulator-backup-2026-11-05.zip'
    );
  });
});

describe('readBackup', () => {
  test('reads back what backupFiles wrote, with image info recomputed', async () => {
    const r = await readBackup(backupFiles(snapshot(), CREATED));
    assert.ok(r.ok);
    assert.equal(r.backup.createdAt, CREATED);
    assert.deepEqual(r.backup.documents, snapshot().documents);
    assert.deepEqual(r.backup.versions, snapshot().versions);
    assert.deepEqual(r.backup.bibFiles, snapshot().bibFiles);
    assert.deepEqual(r.backup.images, snapshot().images);
    assert.equal(r.backup.blobs[0].sha256, PNG_SHA);
    assert.deepEqual(r.backup.blobs[0].info, {
      type: 'png',
      widthPx: 2,
      heightPx: 3,
    });
    assert.equal(r.backup.blobs[0].blob.type, 'image/png');
    assert.deepEqual(
      new Uint8Array(await r.backup.blobs[0].blob.arrayBuffer()),
      PNG
    );
  });

  test('refuses an archive that is not a backup', async () => {
    const r = await readBackup([{ path: 'a.tex', bytes: new Uint8Array() }]);
    assert.deepEqual(r, {
      ok: false,
      message:
        'That zip is not a LaTeX Emulator backup: it has no workspace.json.',
    });
    const bad = (manifest: unknown) =>
      readBackup([
        {
          path: 'workspace.json',
          bytes: new TextEncoder().encode(JSON.stringify(manifest)),
        },
      ]);
    assert.match(
      ((await bad({ format: 'other' })) as { message: string }).message,
      /not a LaTeX Emulator backup/
    );
    assert.match(
      (
        (await bad({ format: BACKUP_FORMAT, version: 2 })) as {
          message: string;
        }
      ).message,
      /newer version/
    );
    const notJson = await readBackup([
      { path: 'workspace.json', bytes: new TextEncoder().encode('{') },
    ]);
    assert.equal(notJson.ok, false);
  });

  test('refuses malformed records rather than storing them', async () => {
    const files = backupFiles(snapshot(), CREATED);
    const tamper = async (edit: (m: Record<string, unknown[]>) => void) => {
      const m = json(files);
      edit(m);
      return readBackup([
        {
          path: 'workspace.json',
          bytes: new TextEncoder().encode(JSON.stringify(m)),
        },
        ...files.slice(1),
      ]);
    };
    for (const edit of [
      (m: Record<string, unknown[]>) => (m.documents[0] = { id: 'x' }),
      (m: Record<string, unknown[]>) => (m.versions = 'none' as never),
      (m: Record<string, unknown[]>) =>
        ((m.bibFiles[0] as { name: unknown }).name = 3),
      (m: Record<string, unknown[]>) =>
        ((m.images[0] as { id: string }).id = 'd2/figs/plot.png'),
      (m: Record<string, unknown[]>) =>
        ((m.images[0] as { name: string }).name = '../x.png'),
    ]) {
      const r = await tamper(edit);
      assert.equal(r.ok, false);
      assert.match((r as { message: string }).message, /damaged/);
    }
  });

  test('a version’s label survives a backup; a malformed one is refused', async () => {
    const s = snapshot();
    s.versions[0].label = 'submitted';
    const r = await readBackup(backupFiles(s, CREATED));
    assert.ok(r.ok);
    assert.strictEqual(r.backup.versions[0].label, 'submitted');
    const files = backupFiles(s, CREATED);
    const m = json(files);
    m.versions[0].label = 7;
    const bad = await readBackup([
      {
        path: 'workspace.json',
        bytes: new TextEncoder().encode(JSON.stringify(m)),
      },
      ...files.slice(1),
    ]);
    assert.strictEqual(bad.ok, false);
  });

  test('refuses a version whose hash does not match its source', async () => {
    const s = snapshot();
    s.versions[0].source = 'changed';
    const r = await readBackup(backupFiles(s, CREATED));
    assert.equal(r.ok, false);
    assert.match((r as { message: string }).message, /0\.1\.0.*checksum/);
  });

  test('refuses image bytes that do not match their hash; skips non-images', async () => {
    const files = backupFiles(snapshot(), CREATED).map((f) =>
      f.path.startsWith('blobs/')
        ? { ...f, bytes: new Uint8Array([1, 2, 3]) }
        : f
    );
    const r = await readBackup(files);
    assert.equal(r.ok, false);
    assert.match((r as { message: string }).message, /checksum/);

    const s = snapshot();
    const junk = new Uint8Array([1, 2, 3]);
    s.blobs = [{ sha256: sha(junk), bytes: junk }];
    s.images[0].sha256 = sha(junk);
    const skipped = await readBackup(backupFiles(s, CREATED));
    assert.ok(skipped.ok);
    assert.deepEqual(skipped.backup.blobs, []);
    // An entry whose bytes are missing is dropped too.
    assert.deepEqual(skipped.backup.images, []);
  });
});

describe('planRestore', () => {
  async function backup() {
    const r = await readBackup(backupFiles(snapshot(), CREATED));
    assert.ok(r.ok);
    return r.backup;
  }
  const empty: CurrentWorkspace = {
    documents: [],
    versionIds: new Set(),
    bibFiles: [],
    images: [],
    blobShas: new Set(),
  };

  test('into an empty browser: everything is added', async () => {
    const plan = planRestore(empty, await backup());
    assert.deepEqual(
      plan.documents.map((d) => d.id),
      ['d1', 'd2']
    );
    assert.equal(plan.versions.length, 1);
    assert.equal(plan.bibFiles.length, 1);
    assert.equal(plan.images.length, 1);
    assert.equal(plan.images[0].blob?.sha256, PNG_SHA);
    assert.equal(
      restoreSummary(plan),
      'Restored 2 documents, 1 version, 1 .bib file and 1 image.'
    );
  });

  test('merges: newer copies win, nothing newer is overwritten', async () => {
    const current: CurrentWorkspace = {
      documents: [
        // Edited here after the backup: kept.
        {
          id: 'd1',
          name: 'Paper',
          source: 'newer',
          createdAt: 1,
          updatedAt: 99,
        },
        // Older here: the backup's copy replaces it.
        { id: 'd2', name: 'Notes', source: 'old', createdAt: 2, updatedAt: 15 },
      ],
      versionIds: new Set(['v1']),
      bibFiles: [{ name: 'references', source: 'same', updatedAt: 3 }],
      images: [{ ...snapshot().images[0] }],
      blobShas: new Set([PNG_SHA]),
    };
    const plan = planRestore(current, await backup());
    assert.deepEqual(
      plan.documents.map((d) => [d.id, d.source]),
      [['d2', 'two']]
    );
    assert.deepEqual(plan.versions, []);
    assert.deepEqual(plan.bibFiles, []);
    assert.deepEqual(plan.images, []);
    assert.equal(plan.unchanged, 4);
    assert.equal(
      restoreSummary(plan),
      'Restored 1 document. 4 items here were the same or newer, so they were kept.'
    );
  });

  test('untouched starter items give way to the backup (a fresh browser)', async () => {
    const current: CurrentWorkspace = {
      ...empty,
      documents: [
        // The starter a fresh browser creates: same name, newer, unedited.
        {
          id: 'fresh',
          name: 'Paper',
          source: 'starter',
          createdAt: 50,
          updatedAt: 50,
        },
      ],
      bibFiles: [{ name: 'references', source: 'starter bib', updatedAt: 50 }],
      untouched: {
        documents: new Set(['fresh']),
        bibFiles: new Set(['references']),
      },
    };
    const plan = planRestore(current, await backup());
    assert.deepEqual(plan.remove, ['fresh']);
    assert.deepEqual(
      plan.documents.map((d) => d.name),
      ['Paper', 'Notes']
    );
    assert.deepEqual(
      plan.bibFiles.map((b) => b.source),
      ['@misc{a,}']
    );
  });

  test('an untouched starter identical to the backup is left alone', async () => {
    const plan = planRestore(
      {
        ...empty,
        bibFiles: [{ name: 'references', source: '@misc{a,}', updatedAt: 50 }],
        untouched: { documents: new Set(), bibFiles: new Set(['references']) },
      },
      await backup()
    );
    assert.deepEqual(plan.bibFiles, []);
  });

  test('a restored document whose name is taken by an edited one gets a unique name', async () => {
    const current: CurrentWorkspace = {
      ...empty,
      documents: [
        {
          id: 'mine',
          name: 'paper',
          source: 'edited',
          createdAt: 50,
          updatedAt: 60,
        },
      ],
    };
    const plan = planRestore(current, await backup());
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(
      plan.documents.map((d) => d.name),
      ['Paper 2', 'Notes']
    );
    // Replacing a document by id keeps its own name.
    const again = planRestore(
      {
        ...empty,
        documents: [
          {
            id: 'd1',
            name: 'Paper',
            source: 'old',
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
      await backup()
    );
    assert.equal(again.documents[0].name, 'Paper');
  });

  test('an image whose bytes are already stored is added without them', async () => {
    const plan = planRestore(
      { ...empty, blobShas: new Set([PNG_SHA]) },
      await backup()
    );
    assert.equal(plan.images.length, 1);
    assert.equal(plan.images[0].blob, undefined);
  });

  test('versions and images of a document that is not restored are dropped', async () => {
    const b = await backup();
    b.documents = [];
    const plan = planRestore(empty, b);
    assert.deepEqual(plan.versions, []);
    assert.deepEqual(plan.images, []);
  });

  test('a backup with nothing new says so', async () => {
    const b = await backup();
    const plan = planRestore(
      {
        documents: b.documents,
        versionIds: new Set(['v1']),
        bibFiles: b.bibFiles,
        images: b.images,
        blobShas: new Set([PNG_SHA]),
      },
      b
    );
    assert.equal(
      restoreSummary(plan),
      'Nothing to restore: everything in the backup is already here (5 items).'
    );
  });
});

describe('comments in backups (ADR 0025)', () => {
  const thread = (id: string, updatedAt: number) => ({
    id,
    anchor: { start: 0, end: 3, quote: 'one' },
    openedBy: 'you' as const,
    status: 'open' as const,
    messages: [{ author: 'you' as const, text: 'Why?', at: updatedAt }],
    updatedAt,
  });
  const withComments = (): WorkspaceSnapshot => ({
    ...snapshot(),
    comments: [
      { documentId: 'd1', threads: [thread('t1', 30)], updatedAt: 30 },
      { documentId: 'gone', threads: [thread('t9', 30)], updatedAt: 30 },
    ],
  });

  test('written into workspace.json and read back; malformed threads dropped', async () => {
    const files = backupFiles(withComments(), CREATED);
    const manifest = json(files);
    assert.equal(manifest.comments[0].documentId, 'd1');
    manifest.comments[0].threads.push({ id: 7 });
    files[0] = {
      path: 'workspace.json',
      bytes: new TextEncoder().encode(JSON.stringify(manifest)),
    };
    const r = await readBackup(files);
    assert.ok(r.ok);
    assert.deepEqual(r.backup.comments![0].threads, [thread('t1', 30)]);
  });

  test('an older backup without comments still restores', async () => {
    const r = await readBackup(backupFiles(snapshot(), CREATED));
    assert.ok(r.ok);
    assert.deepEqual(r.backup.comments, []);
  });

  test('restore: the newer threads of each known document win', async () => {
    const r = await readBackup(backupFiles(withComments(), CREATED));
    assert.ok(r.ok);
    const base = {
      documents: [],
      versionIds: new Set<string>(),
      bibFiles: [],
      images: [],
      blobShas: new Set<string>(),
    };
    const fresh = planRestore(base, r.backup);
    // d1 is restored; "gone" is no document here or in the backup.
    assert.deepEqual(
      fresh.comments.map((c) => c.documentId),
      ['d1']
    );
    assert.match(restoreSummary(fresh), /comments on 1 document/);
    const newer = planRestore(
      { ...base, comments: [{ documentId: 'd1', threads: [], updatedAt: 40 }] },
      r.backup
    );
    assert.deepEqual(newer.comments, []);
  });
});
