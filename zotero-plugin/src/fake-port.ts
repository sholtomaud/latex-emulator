import type { PortItem, ZoteroPort } from './port.ts';

/** An in-memory Zotero for tests: items by key, search by title words. */
export function fakePort(items: PortItem[]): ZoteroPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
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
