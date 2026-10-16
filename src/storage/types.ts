// The library's records, and where they're kept: this browser's database (a guest) or the
// HarpForge server's data folder (an account). The library (library.ts) works on either.
// (No imports: the server reads these types too.)

export interface SavedTab {
  id: string;
  title: string;
  harmonica: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  /** When it was moved to the trash (not there: undefined). */
  deletedAt?: number;
}

/** What made a version: a save of yours, a demo brought up to date, a backup restored, a recovery. */
export type VersionKind = 'save' | 'demo' | 'import' | 'recover';

/** A tab as it was saved once (the newest is the tab as it is now). */
export interface TabVersion {
  id: string;
  tabId: string;
  at: number;
  text: string;
  title: string;
  kind: VersionKind;
  /** Named by you ("before the new chorus"): never thinned out. */
  name?: string;
}

/** Where a library is kept. */
export interface LibraryBackend {
  kind: 'browser' | 'account';
  /** Whose: "browser", or "account:<name>" (as the open song's working copy notes it). */
  owner: string;
  tabs: {
    get(id: string): Promise<SavedTab | undefined>;
    all(): Promise<SavedTab[]>;
    /**
     * Writes a tab. With `expectText`, only if the stored one still has that text (else a
     * BackendClash with what's there): nothing else saved it in between.
     */
    put(tab: SavedTab, expectText?: string): Promise<void>;
    delete(id: string): Promise<void>;
  };
  versions: {
    /** A version (`tabId`, if known: looked for only in that tab's history). */
    get(id: string, tabId?: string): Promise<TabVersion | undefined>;
    ofTab(tabId: string): Promise<TabVersion[]>;
    all(): Promise<TabVersion[]>;
    add(versions: TabVersion[]): Promise<void>;
    put(version: TabVersion): Promise<void>;
    /** Deletes versions (`tabId`, if they're all one tab's: only its history is looked through). */
    delete(ids: string[], tabId?: string): Promise<void>;
    /** How many versions there are and their texts' size, without fetching them all (if the storage can). */
    stats?(): Promise<{ versions: number; bytes: number }>;
    deleteOfTab(tabId: string): Promise<void>;
  };
  /** Small values the library keeps with itself (which demos it has had). */
  meta: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string | null): Promise<void>;
  };
  /** Runs `fn` as one change where the storage can (the browser database); else just runs it. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/** A write refused because the tab had changed: what's stored now. */
export class BackendClash extends Error {
  saved: SavedTab;
  constructor(saved: SavedTab) {
    super('changed since it was read');
    this.saved = saved;
  }
}
