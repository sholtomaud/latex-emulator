import type { PortItem, PortNote, ZoteroPort } from './port.ts';

/**
 * An in-memory Zotero for tests: items by key, search by title words, and
 * the Zettelkasten collection's notes (`notes`; `outside` are notes that
 * exist but aren't in the collection).
 */
export function fakePort(
  items: PortItem[],
  notes: PortNote[] = [],
  outside: PortNote[] = []
): ZoteroPort & { calls: string[]; notes: PortNote[] } {
  const calls: string[] = [];
  let next = 1;
  const any = (key: string) =>
    notes.find((n) => n.key === key) ??
    outside.find((n) => n.key === key) ??
    items.find((i) => i.key === key);
  return {
    calls,
    notes,
    async zettelNotes() {
      calls.push('zettelNotes');
      return notes.map((n) => ({ ...n, related: [...n.related] }));
    },
    async createZettelNote(html, tags) {
      const key = `NOTE${String(next++).padStart(4, '0')}`;
      calls.push(`create ${key}`);
      notes.push({ key, html, tags: [...tags], related: [] });
      return key;
    },
    async setNoteHtml(key, html) {
      calls.push(`html ${key}`);
      const note = notes.find((n) => n.key === key);
      if (!note) throw new Error(`no note ${key}`);
      note.html = html;
    },
    async relate(a, b, related) {
      calls.push(`${related ? 'relate' : 'unrelate'} ${a} ${b}`);
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        const item = any(x);
        if (!item) throw new Error(`no item ${x}`);
        if (!('related' in item)) continue; // regular items: not tracked here
        item.related = item.related.filter((k) => k !== y);
        if (related) item.related.push(y);
      }
    },
    async setTags(key, add, remove) {
      calls.push(`tags ${key} +${add.join(',')} -${remove.join(',')}`);
      const note = notes.find((n) => n.key === key);
      if (!note) throw new Error(`no note ${key}`);
      note.tags = [...new Set([...note.tags, ...add])].filter(
        (t) => !remove.includes(t)
      );
    },
    async search(query, limit) {
      calls.push(`search ${query} ${limit}`);
      const words = query.toLowerCase().split(/\s+/);
      return items
        .filter((i) =>
          words.every((w) =>
            `${i.fields.title ?? ''} ${i.creators.map((c) => c.lastName ?? c.name).join(' ')}`
              .toLowerCase()
              .includes(w)
          )
        )
        .slice(0, limit);
    },
    async getItem(key) {
      calls.push(`get ${key}`);
      return items.find((i) => i.key === key) ?? null;
    },
    async bibtex(key) {
      calls.push(`bibtex ${key}`);
      return `@book{${key},\n}\n`;
    },
  };
}

export const ODUM: PortItem = {
  key: 'ABCD2345',
  itemType: 'book',
  fields: {
    title: 'Environmental Accounting: Emergy and Environmental Decision Making',
    date: '1996',
    publisher: 'Wiley',
  },
  creators: [
    { creatorType: 'author', firstName: 'Howard T.', lastName: 'Odum' },
  ],
  tags: ['emergy'],
  citationKey: null,
  csl: {
    type: 'book',
    title: 'Environmental Accounting: Emergy and Environmental Decision Making',
    author: [{ family: 'Odum', given: 'Howard T.' }],
    issued: { 'date-parts': [[1996]] },
  },
  attachments: [
    { key: 'PDFK2345', title: 'Full Text PDF', contentType: 'application/pdf' },
  ],
};

export const IPCC: PortItem = {
  key: 'WXYZ6789',
  itemType: 'report',
  fields: { title: 'Climate Change 2021', date: 'August 2021' },
  creators: [{ creatorType: 'author', name: 'IPCC' }],
  tags: [],
  citationKey: 'ipcc2021',
  csl: { type: 'report', title: 'Climate Change 2021' },
  attachments: [],
};
