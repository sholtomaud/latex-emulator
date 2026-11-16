/** ZoteroPort over Zotero's own JavaScript API: the user's library only. */
import type { PortCreator, PortItem, PortNote, ZoteroPort } from '../port.ts';

// Translator IDs (Zotero's translators/ folder; Better BibTeX's own).
const BETTER_BIBTEX = 'ca65189f-8815-4afe-8c8b-8c7c15f0edca';
const BIBTEX = '9cb70025-a888-4a29-a210-93ec52da40d4';

/** toJSON() keys that are not item fields. */
const NOT_FIELDS = new Set([
  'key',
  'version',
  'itemType',
  'creators',
  'tags',
  'collections',
  'relations',
  'dateAdded',
  'dateModified',
  'deleted',
  'inPublications',
]);

const library = () => Zotero.Libraries.userLibraryID;

function citationKey(item: ZoteroItem): string | null {
  const bbt = Zotero.BetterBibTeX?.KeyManager?.get(item.id)?.citationKey;
  if (bbt) return bbt;
  try {
    return item.getField('citationKey') || null;
  } catch {
    return null; // a Zotero without the field
  }
}

function toPortItem(item: ZoteroItem): PortItem {
  const json = item.toJSON();
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(json))
    if (!NOT_FIELDS.has(name) && typeof value === 'string' && value)
      fields[name] = value;
  return {
    key: item.key,
    itemType: item.itemType,
    fields,
    creators: (json.creators as PortCreator[] | undefined) ?? [],
    tags: ((json.tags as { tag: string }[] | undefined) ?? []).map(
      (t) => t.tag
    ),
    citationKey: citationKey(item),
    csl: Zotero.Utilities.Item.itemToCSLJSON(item),
    attachments: Zotero.Items.get(item.getAttachments()).map((a) => ({
      key: a.key,
      title: a.getField('title'),
      contentType: a.attachmentContentType ?? '',
    })),
  };
}

/** The Zettelkasten collection's name (the settings pane can change it). */
export const ZETTEL_COLLECTION = 'extensions.latex-emulator.zettelCollection';
const collectionName = () =>
  String(Zotero.Prefs.get(ZETTEL_COLLECTION, true) ?? '').trim() ||
  'Zettelkasten';

/** The top-level collection of that name; made when `create` and missing. */
async function zettelCollection(
  create: boolean
): Promise<ZoteroCollection | null> {
  const name = collectionName();
  const found = Zotero.Collections.getByLibrary(library()).find(
    (c) => c.name === name && !c.parentID && !c.deleted
  );
  if (found || !create) return found ?? null;
  const made = new Zotero.Collection();
  made.libraryID = library();
  made.name = name;
  await made.saveTx();
  return made;
}

const isZettelNote = (i: ZoteroItem) => i.isNote() && !i.parentKey;

function toPortNote(item: ZoteroItem): PortNote {
  return {
    key: item.key,
    html: item.getNote(),
    tags: item.getTags().map((t) => t.tag),
    related: item.relatedItems,
  };
}

async function anyItem(key: string): Promise<ZoteroItem> {
  const item = await Zotero.Items.getByLibraryAndKeyAsync(library(), key);
  if (!item || item.deleted) throw new Error(`No item ${key}.`);
  return item;
}

async function zettelNote(key: string): Promise<ZoteroItem> {
  const item = await anyItem(key);
  if (!isZettelNote(item)) throw new Error(`${key} is not a standalone note.`);
  return item;
}

async function regularItem(key: string): Promise<ZoteroItem | null> {
  const item = await Zotero.Items.getByLibraryAndKeyAsync(library(), key);
  return item && item.isRegularItem() ? item : null;
}

export const zoteroPort: ZoteroPort = {
  async search(query, limit) {
    const search = new Zotero.Search();
    search.libraryID = library();
    // The same match as the quick-search box's "Title, Creator, Year" mode.
    search.addCondition('quicksearch-titleCreatorYear', 'contains', query);
    const items = await Zotero.Items.getAsync(await search.search());
    return items
      .filter((i) => i.isRegularItem())
      .slice(0, limit)
      .map(toPortItem);
  },
  async getItem(key) {
    const item = await regularItem(key);
    return item ? toPortItem(item) : null;
  },
  async bibtex(key) {
    const item = await regularItem(key);
    if (!item) return '';
    // Just after Zotero starts, translators may still be loading; init()
    // returns that load (or its finished promise) rather than starting again.
    await Zotero.Translators.init();
    const exporter = new Zotero.Translate.Export();
    exporter.setItems([item]);
    exporter.setTranslator(Zotero.BetterBibTeX ? BETTER_BIBTEX : BIBTEX);
    await exporter.translate();
    return exporter.string;
  },
  async zettelNotes() {
    const collection = await zettelCollection(false);
    return collection
      ? collection
          .getChildItems(false, false)
          .filter(isZettelNote)
          .map(toPortNote)
      : [];
  },
  async createZettelNote(html, tags) {
    const collection = (await zettelCollection(true))!;
    const note = new Zotero.Item('note');
    note.libraryID = library();
    note.setNote(html);
    note.setCollections([collection.id]);
    for (const tag of tags) note.addTag(tag);
    await note.saveTx();
    return note.key;
  },
  async setNoteHtml(key, html) {
    const note = await zettelNote(key);
    note.setNote(html);
    await note.saveTx();
  },
  async relate(a, b, related) {
    const x = await anyItem(a);
    const y = await anyItem(b);
    // Related is stored on each item: change and save both, together.
    if (related) {
      x.addRelatedItem(y);
      y.addRelatedItem(x);
    } else {
      await x.removeRelatedItem(y);
      await y.removeRelatedItem(x);
    }
    await Zotero.DB.executeTransaction(async () => {
      await x.save();
      await y.save();
    });
  },
  async setTags(key, add, remove) {
    const note = await zettelNote(key);
    for (const tag of add) note.addTag(tag);
    for (const tag of remove) note.removeTag(tag);
    await note.saveTx();
  },
};
