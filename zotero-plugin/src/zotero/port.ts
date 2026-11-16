/** ZoteroPort over Zotero's own JavaScript API: the user's library only. */
import type { PortCreator, PortItem, ZoteroPort } from '../port.ts';

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
};
