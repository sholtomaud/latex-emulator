/**
 * The few parts of Zotero's (and Firefox's) privileged JavaScript API the
 * plugin uses, typed just enough for `tsc`. Checked against Zotero 10's
 * source and exercised by the real-Zotero CI job (ADR 0024 §7).
 */

interface ZoteroItem {
  id: number;
  key: string;
  itemType: string;
  libraryID: number;
  deleted: boolean;
  parentKey: string | false;
  /** Keys of Related items. */
  relatedItems: string[];
  isRegularItem(): boolean;
  isNote(): boolean;
  getNote(): string;
  setNote(html: string): boolean;
  getTags(): { tag: string }[];
  addTag(name: string): boolean;
  removeTag(name: string): boolean;
  setCollections(ids: number[]): void;
  addRelatedItem(item: ZoteroItem): boolean;
  removeRelatedItem(item: ZoteroItem): Promise<boolean>;
  save(): Promise<unknown>;
  saveTx(): Promise<unknown>;
  getField(name: string): string;
  getAttachments(): number[];
  attachmentContentType: string;
  toJSON(): Record<string, unknown>;
}

interface ZoteroCollection {
  id: number;
  name: string;
  libraryID: number;
  parentID: number | false;
  deleted: boolean;
  getChildItems(asIDs: false, includeTrashed: boolean): ZoteroItem[];
  saveTx(): Promise<unknown>;
}

interface ZoteroServerRequest {
  method: string;
  pathname: string;
  headers: Record<string, string>;
  data: unknown;
}

interface ZoteroEndpoint {
  supportedMethods: string[];
  supportedDataTypes: string[];
  allowRequestsFromUnsafeWebContent: boolean;
  init(
    request: ZoteroServerRequest
  ): Promise<[number, Record<string, string>, string]>;
}

declare const Zotero: {
  version: string;
  initializationPromise: Promise<void>;
  debug(message: string): void;
  logError(error: unknown): void;
  getMainWindow(): Window | null;
  Prefs: {
    get(name: string, global: true): string | number | boolean | undefined;
    set(name: string, value: string, global: true): void;
  };
  Libraries: { userLibraryID: number };
  Item: new (itemType: string) => ZoteroItem;
  Collection: new () => ZoteroCollection;
  Collections: {
    getByLibrary(libraryID: number): ZoteroCollection[];
  };
  DB: { executeTransaction<T>(fn: () => Promise<T>): Promise<T> };
  Search: new () => {
    libraryID: number;
    addCondition(condition: string, operator: string, value: string): void;
    search(): Promise<number[]>;
  };
  Items: {
    getAsync(ids: number[]): Promise<ZoteroItem[]>;
    get(ids: number[]): ZoteroItem[];
    getByLibraryAndKeyAsync(
      libraryID: number,
      key: string
    ): Promise<ZoteroItem | false>;
  };
  Utilities: {
    Item: { itemToCSLJSON(item: ZoteroItem): Record<string, unknown> };
  };
  Translators: { init(): Promise<void> };
  Translate: {
    Export: new () => {
      setItems(items: ZoteroItem[]): void;
      setTranslator(id: string): void;
      translate(): Promise<void>;
      string: string;
    };
  };
  Server: {
    Endpoints: Record<string, unknown>;
    responseCodes: Record<number, string>;
  };
  PreferencePanes: {
    register(options: {
      pluginID: string;
      src: string;
      label?: string;
      scripts?: string[];
    }): Promise<string>;
    unregister(id: string): void;
  };
  BetterBibTeX?: {
    KeyManager?: { get(itemID: number): { citationKey?: string } | undefined };
  };
  LatexEmulator?: unknown;
};

declare const Services: {
  prompt: {
    BUTTON_POS_0: number;
    BUTTON_POS_1: number;
    BUTTON_TITLE_IS_STRING: number;
    BUTTON_POS_1_DEFAULT: number;
    confirmEx(
      parent: Window | null,
      title: string,
      text: string,
      flags: number,
      button0: string | null,
      button1: string | null,
      button2: string | null,
      checkLabel: string | null,
      checkState: { value: boolean }
    ): number;
    prompt(
      parent: Window | null,
      title: string,
      text: string,
      value: { value: string },
      checkLabel: string | null,
      checkState: { value: boolean }
    ): boolean;
    alert(parent: Window | null, title: string, text: string): void;
  };
};

declare const Components: {
  classes: Record<string, { getService(iface: unknown): unknown }>;
  interfaces: Record<string, unknown>;
};
