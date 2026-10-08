import { DEFAULT_PLAIN_TEXT, type PlainTextOptions } from '../core/formats/plaintext';
import { FAMILIES, keysFor, type Family, type HarmonicaSpec } from '../core/instruments';
import { create } from 'zustand';
import { parseHtab } from '../core/htab/parser';
import type { ParseIssue, TabDoc } from '../core/htab/types';
import { harmonicaFromMeta, buildScore, eventKey, type Score } from '../core/score';
import type { Harmonica } from '../core/instruments';
import type { HoleSound } from '../core/types';
import { TWINKLE } from '../demo/songs';
import { newSessionId, readWorking, sessionId, setSessionId, watchForClash, writeWorking, type WorkingCopy } from './working';

export type Page = 'play' | 'editor' | 'library' | 'print';
export type PlayState = 'stopped' | 'playing' | 'paused';

export interface Parsed {
  text: string;
  doc: TabDoc;
  harp: Harmonica;
  score: Score;
  issues: ParseIssue[];
  /** eventKey(line, eventIndex) → score index */
  indexByKey: Map<string, number>;
}

let parsedCache: Parsed | null = null;

/** Parses .htab text into everything the views need (not cached). */
export function makeParsed(text: string): Parsed {
  const { doc, issues } = parseHtab(text);
  const harp = harmonicaFromMeta(doc.meta);
  const built = buildScore(doc, harp);
  const indexByKey = new Map<string, number>();
  for (const ev of built.score.events) indexByKey.set(eventKey(ev.line, ev.eventIndex), ev.index);
  return { text, doc, harp, score: built.score, issues: [...issues, ...built.issues], indexByKey };
}

/** Parses the current text (memoized on the text). */
export function getParsed(text: string): Parsed {
  if (parsedCache && parsedCache.text === text) return parsedCache;
  parsedCache = makeParsed(text);
  return parsedCache;
}

const local = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};
const session = (): Storage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};
/** This browser tab's working-copy id (see working.ts). */
let tabId = sessionId(session());

function loadWorking(): WorkingCopy {
  const store = local();
  return (store && readWorking(store, tabId)) ?? { text: TWINKLE, docId: null, savedText: TWINKLE };
}

export type SheetView = 'simple' | 'tab' | 'staff' | 'numbers';
export type HarpSize = 'full' | 'slim' | 'hidden';
export type EditorMode = 'visual' | 'text' | 'split';

/** Visual editor UI state. Positions are (measure index, start beat). */
export interface VisualState {
  selection: import('../core/edit/model').Pos[];
  /** Where a Shift-click range starts (the last note clicked without Shift). */
  anchor?: import('../core/edit/model').Pos;
  caret: import('../core/edit/model').Pos;
  /** Measure shown in the inspector when no note is selected. */
  measure: number;
  /** Duration tool for new notes: base value in beats, dotted, triplet. */
  dur: number;
  dotted: boolean;
  triplet: boolean;
  /** Grid in beats; 0: auto (follows the length of the note being placed or dragged). */
  snap: number;
  /** Pixels per beat. */
  zoom: number;
  /** Insert mode: new notes and longer notes push the music after them along; deleting closes the gap. */
  insert: boolean;
  /** Step entry: playing a hole inserts it at the caret. */
  step: boolean;
  /** Sound used for notes added without the harmonica. */
  lastSounds: import('../core/types').Sound[];
  /** The inspector tab chosen by hand; otherwise it follows the selection (note, or the song). */
  panel?: 'note' | 'measure';
  /** The note step entry wrote last (outlined; it isn't selected, so length keys set the next note). */
  justEntered?: import('../core/edit/model').Pos;
}

/** A file or pasted text waiting in the import dialog. */
export interface ImportDraft {
  name: string;
  /** Raw text for the paste box (paste mode). */
  pasteText?: string;
  imported?: import('../core/formats').Imported & { kind: import('../core/formats').ImportKind };
  error?: string;
  /** While a PDF is being read. */
  progress?: { message: string; fraction: number };
  /** Text recognised from a PDF, so it can be corrected by hand. */
  sourceText?: string;
  /** Which PDF reading this dialog shows (a cancelled one's results are ignored). */
  run?: number;
}

export interface MicState {
  status: 'off' | 'starting' | 'on' | 'error';
  level: number;
  reading: import('../live/inputs').MicReading | null;
  error?: string;
}

export interface MidiState {
  status: 'off' | 'on' | 'unsupported' | 'error';
  devices: string[];
  /** Last note that couldn't be played. */
  miss?: string;
}

export interface PracticeState {
  /** Score index of the note to play next. */
  index: number;
  played: number;
  mistakes: number;
  startedAt: number;
  /** Time of the last wrong note (for a brief shake). */
  wrongAt: number;
}

/** One undo step: the text, and where the visual editor's selection was. */
export interface HistoryEntry {
  text: string;
  sel: Pick<VisualState, 'selection' | 'caret' | 'measure'>;
}

const snapshot = (s: { text: string; ve: VisualState }): HistoryEntry => ({ text: s.text, sel: { selection: s.ve.selection, caret: s.ve.caret, measure: s.ve.measure } });

export interface RecordingState {
  mode: 'timed' | 'free';
  phase: 'count-in' | 'recording';
}

export interface AppState {
  page: Page;
  text: string;
  docId: string | null;
  savedText: string | null;
  play: PlayState;
  /** Score indices currently sounding during playback. */
  activeEvents: number[];
  /** Score index of the selected card (playback starts here). */
  selectedEvent: number | null;
  /** A stretch chosen on the Play page (Shift+click, bar numbers), in score beats. */
  passage: import('../core/passage').Passage | null;
  loop: boolean;
  /** What the loop repeats: a passage, or (null) the whole song from where playback starts. */
  loopRange: import('../core/passage').Passage | null;
  metronome: boolean;
  /** Count in (a bar of clicks, two at fast tempos) before playback starts. Remembered. */
  countIn: boolean;
  /** Count in again before each pass of a loop. Remembered. */
  countEachLoop: boolean;
  /** Playback speed multiplier (practice slow-down). */
  speed: number;
  /** Live-held sounds by input id (mouse, key codes). */
  held: Record<string, HoleSound>;
  /** First hole mapped to the keyboard rows (for harmonicas with > 12 holes). */
  keyOffset: number;
  /** Chromatic slide button latched on (mouse / button). */
  slideLatch: boolean;
  showNoteNames: boolean;
  /** Read the music as holes (4 -4) or as notes (C5 D5); the file always stores holes. */
  readAs: ReadAs;
  recording: RecordingState | null;
  recordAppend: boolean;
  recordGrid: number;
  toast: { message: string; id: number } | null;
  sheetView: SheetView;
  importDraft: ImportDraft | null;
  mic: MicState;
  /** 0..1: how quiet a sound the microphone still listens to. */
  micSensitivity: number;
  midi: MidiState;
  practice: PracticeState | null;
  /** Recorded harmonica samples or the synthesized reed. */
  soundMode: 'samples' | 'synth';
  /** What the Tab and Numbers views show besides the notes (note names in Tab = showNoteNames). */
  sheetShow: SheetShow;
  /** The harmonicas you own (remembered): import ranks them first. */
  ownedHarps: import('../core/instruments').HarmonicaSpec[];
  /** Plain-text export: open, and its choices (remembered). */
  plainTextOpen: boolean;
  textPrefs: import('../core/formats/plaintext').PlainTextOptions;
  /** Print view choices (remembered). */
  printPrefs: import('../pages/PrintPage').PrintPrefs;
  /** Play page: the harmonica drawn in full, as a slim row of holes, or hidden (the keyboard still plays). */
  harpSize: HarpSize;
  /** Visual editor: measures fill each row (true) or follow the text's lines. */
  fitWidth: boolean;
  /** Editor: the docked harmonica is open (remembered). */
  dockOpen: boolean;
  /** Editor: a time-signature change re-bars the notes (⋯ → Measures). */
  rebar: boolean;
  editorMode: EditorMode;
  ve: VisualState;
  setVe(patch: Partial<VisualState>): void;
  samplesStatus: 'idle' | 'loading' | 'ready' | 'error';

  setPage(p: Page): void;
  /** The page before this one (where the print view's Back goes). */
  prevPage: Page;
  /** Changes the tab text and records an undo step ('typing' groups quick keystrokes). */
  /** `kind`: 'typing…' edits of the same kind in quick succession make one undo step (typing the title, then the artist, makes two). */
  setText(t: string, opts?: { kind?: 'typing' | `typing:${string}` | 'edit' }): void;
  undo(): void;
  redo(): void;
  history: { past: HistoryEntry[]; future: HistoryEntry[]; lastKind: string; lastAt: number; groupAt: number };
  loadText(t: string, docId?: string | null, saved?: boolean): void;
  /** Counts tabs opened (loadText), so a save that finishes later knows if its tab is still open. */
  loadSeq: number;
  /** Marks `text` (what was actually written to the library) as saved under `docId`. */
  markSaved(docId: string, text?: string): void;
  notify(message: string): void;
}

const initial = loadWorking();

const PREFS_KEY = 'harpforge:prefs';
export type ReadAs = 'holes' | 'notes';
export interface SheetShow {
  /** `holes`: the small holes under the notes in Notes mode (note names in Holes mode = showNoteNames). */
  tab: { lyrics: boolean; chords: boolean; holes: boolean };
  numbers: { holes: boolean; lyrics: boolean; chords: boolean };
  staff: { holes: boolean; lyrics: boolean; chords: boolean; header: boolean };
}
const SHOW_ALL: SheetShow = {
  tab: { lyrics: true, chords: true, holes: true },
  numbers: { holes: true, lyrics: true, chords: true },
  // The page already shows the title and tempo, so the staff leaves them out unless asked.
  staff: { holes: true, lyrics: true, chords: true, header: false },
};

function loadPrefs(): {
  soundMode?: 'samples' | 'synth';
  harpSize?: HarpSize;
  fitWidth?: boolean;
  dockOpen?: boolean;
  zoom?: number;
  showNoteNames?: boolean;
  readAs?: ReadAs;
  sheetShow?: { [K in keyof SheetShow]?: Partial<SheetShow[K]> };
  printPrefs?: Partial<import('../pages/PrintPage').PrintPrefs>;
  textPrefs?: Partial<import('../core/formats/plaintext').PlainTextOptions>;
  ownedHarps?: import('../core/instruments').HarmonicaSpec[];
  countIn?: boolean;
  countEachLoop?: boolean;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(local()?.getItem(PREFS_KEY) ?? '{}');
  } catch {
    return {};
  }
  // Anything that isn't what we wrote (corrupted, or from another version) falls back to the default.
  const p = isObject(raw) ? raw : {};
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  const sheet = isObject(p.sheetShow) ? p.sheetShow : {};
  const print = like(p.printPrefs, { view: 'tab', size: 'normal', title: true, details: true, chart: false });
  if (print.view !== undefined && !['simple', 'tab', 'staff', 'numbers'].includes(print.view)) delete print.view;
  if (print.size !== undefined && !['compact', 'normal', 'large'].includes(print.size)) delete print.size;
  return {
    soundMode: p.soundMode === 'synth' ? 'synth' : p.soundMode === 'samples' ? 'samples' : undefined,
    // Before there were sizes, the harmonica was either shown or hidden.
    harpSize: p.harpSize === 'full' || p.harpSize === 'slim' || p.harpSize === 'hidden' ? p.harpSize : p.harpHidden === true ? 'hidden' : undefined,
    fitWidth: bool(p.fitWidth),
    dockOpen: bool(p.dockOpen),
    zoom: typeof p.zoom === 'number' && p.zoom >= 32 && p.zoom <= 160 ? Math.round(p.zoom) : undefined,
    showNoteNames: bool(p.showNoteNames),
    countIn: bool(p.countIn),
    countEachLoop: bool(p.countEachLoop),
    readAs: p.readAs === 'notes' ? 'notes' : p.readAs === 'holes' ? 'holes' : undefined,
    sheetShow: { tab: like(sheet.tab, SHOW_ALL.tab), numbers: like(sheet.numbers, SHOW_ALL.numbers), staff: like(sheet.staff, SHOW_ALL.staff) },
    printPrefs: print as Partial<import('../pages/PrintPage').PrintPrefs>,
    textPrefs: textPrefsFrom(p.textPrefs),
    ownedHarps: Array.isArray(p.ownedHarps)
      ? p.ownedHarps.filter(
          (h): h is HarmonicaSpec =>
            isObject(h) && FAMILIES.some((f) => f.id === h.family) && typeof h.key === 'string' && keysFor(h.family as Family).includes(h.key),
        )
      : undefined,
  };
}

/** Plain-text choices, each one of its allowed values. */
function textPrefsFrom(v: unknown): Partial<PlainTextOptions> {
  const t = like(v, DEFAULT_PLAIN_TEXT);
  const allowed: Partial<Record<keyof PlainTextOptions, unknown[]>> = {
    spelling: ['holes', 'notes'],
    style: ['htab', 'plusminus', 'letters'],
    bend: ['apostrophe', 'b'],
    over: ['o', 'ob'],
  };
  for (const [k, values] of Object.entries(allowed) as [keyof PlainTextOptions, unknown[]][]) if (k in t && !values.includes(t[k])) delete t[k];
  if (t.width !== undefined && !(t.width >= 40 && t.width <= 120)) delete t.width;
  return t;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The fields of `v` that have the same type as in `defaults`. */
function like<T extends object>(v: unknown, defaults: T): Partial<T> {
  if (!isObject(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(defaults)) if (typeof v[k] === typeof d) out[k] = v[k];
  return out as Partial<T>;
}
const prefs = loadPrefs();

export const useApp = create<AppState>((set) => ({
  page: 'play',
  text: initial.text,
  docId: initial.docId,
  savedText: initial.savedText,
  play: 'stopped',
  activeEvents: [],
  selectedEvent: null,
  passage: null,
  loop: false,
  loopRange: null,
  metronome: false,
  countIn: prefs.countIn ?? false,
  countEachLoop: prefs.countEachLoop ?? false,
  speed: 1,
  held: {},
  keyOffset: 0,
  slideLatch: false,
  showNoteNames: prefs.showNoteNames ?? true,
  readAs: prefs.readAs === 'notes' ? 'notes' : 'holes',
  recording: null,
  recordAppend: true,
  recordGrid: 0.5,
  toast: null,
  sheetView: 'tab',
  importDraft: null,
  mic: { status: 'off', level: 0, reading: null },
  micSensitivity: 0.7,
  midi: { status: 'off', devices: [] },
  practice: null,
  soundMode: prefs.soundMode === 'synth' ? 'synth' : 'samples',
  harpSize: prefs.harpSize ?? 'full',
  printPrefs: { view: 'tab', size: 'normal', title: true, details: true, chart: false, ...prefs.printPrefs },
  plainTextOpen: false,
  ownedHarps: Array.isArray(prefs.ownedHarps) ? prefs.ownedHarps : [],
  textPrefs: { ...DEFAULT_PLAIN_TEXT, ...prefs.textPrefs },
  sheetShow: {
    tab: { ...SHOW_ALL.tab, ...prefs.sheetShow?.tab },
    numbers: { ...SHOW_ALL.numbers, ...prefs.sheetShow?.numbers },
    staff: { ...SHOW_ALL.staff, ...prefs.sheetShow?.staff },
  },
  fitWidth: prefs.fitWidth !== false,
  dockOpen: prefs.dockOpen !== false,
  rebar: true,
  editorMode: 'visual',
  ve: {
    selection: [],
    caret: { m: 0, start: 0 },
    measure: 0,
    dur: 1,
    dotted: false,
    triplet: false,
    snap: 0,
    zoom: prefs.zoom ?? 64,
    step: false,
    insert: false,
    lastSounds: [{ type: 'hole', hole: 4, breath: 'blow', bend: 0, over: false, slide: false }],
  },
  // A new selection takes the inspector back to following it (unless the patch picks a tab).
  setVe: (patch) => set((s) => ({ ve: { ...s.ve, ...('selection' in patch && !('panel' in patch) ? { panel: undefined } : {}), ...patch } })),
  samplesStatus: 'idle',

  prevPage: 'play',
  setPage: (page) => set((s) => (page === s.page ? {} : { page, prevPage: s.page })),
  setText: (text, opts) =>
    set((s) => {
      if (text === s.text) return {};
      const kind = opts?.kind ?? 'edit';
      const now = Date.now();
      const h = s.history;
      // Quick keystrokes make one undo step, but not forever: a step covers at most a few seconds.
      const merge = kind.startsWith('typing') && h.lastKind === kind && now - h.lastAt < 1200 && now - h.groupAt < 5000;
      return {
        text,
        selectedEvent: null,
        history: { past: merge ? h.past : [...h.past, snapshot(s)].slice(-300), future: [], lastKind: kind, lastAt: now, groupAt: merge ? h.groupAt : now },
      };
    }),
  undo: () =>
    set((s) => {
      const h = s.history;
      const prev = h.past[h.past.length - 1];
      if (!prev) return {};
      return { text: prev.text, ve: { ...s.ve, ...prev.sel }, selectedEvent: null, history: { past: h.past.slice(0, -1), future: [snapshot(s), ...h.future], lastKind: 'undo', lastAt: 0, groupAt: 0 } };
    }),
  redo: () =>
    set((s) => {
      const h = s.history;
      const next = h.future[0];
      if (!next) return {};
      return { text: next.text, ve: { ...s.ve, ...next.sel }, selectedEvent: null, history: { past: [...h.past, snapshot(s)], future: h.future.slice(1), lastKind: 'redo', lastAt: 0, groupAt: 0 } };
    }),
  history: { past: [], future: [], lastKind: '', lastAt: 0, groupAt: 0 },
  loadSeq: 0,
  loadText: (text, docId = null, saved = false) =>
    // A different tab: the editor's caret and selection start over (they belonged to the old one).
    set((s) => ({ ve: { ...s.ve, selection: [], anchor: undefined, panel: undefined, justEntered: undefined, caret: { m: 0, start: 0 }, measure: 0 }, loadSeq: s.loadSeq + 1, text, docId, savedText: saved ? text : null, selectedEvent: null, passage: null, loopRange: null, loop: s.loopRange ? false : s.loop, activeEvents: [], history: { past: [], future: [], lastKind: '', lastAt: 0, groupAt: 0 } })),
  markSaved: (docId, text) => set((s) => ({ docId, savedText: text ?? s.text })),
  notify: (message) => set({ toast: { message, id: Date.now() } }),
}));

// Remember preferences.
useApp.subscribe((s, prev) => {
  if (s.soundMode === prev.soundMode && s.harpSize === prev.harpSize && s.fitWidth === prev.fitWidth && s.dockOpen === prev.dockOpen && s.ve.zoom === prev.ve.zoom && s.showNoteNames === prev.showNoteNames && s.readAs === prev.readAs && s.sheetShow === prev.sheetShow && s.printPrefs === prev.printPrefs && s.textPrefs === prev.textPrefs && s.ownedHarps === prev.ownedHarps && s.countIn === prev.countIn && s.countEachLoop === prev.countEachLoop) return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ soundMode: s.soundMode, harpSize: s.harpSize, fitWidth: s.fitWidth, dockOpen: s.dockOpen, zoom: s.ve.zoom, showNoteNames: s.showNoteNames, readAs: s.readAs, sheetShow: s.sheetShow, printPrefs: s.printPrefs, textPrefs: s.textPrefs, ownedHarps: s.ownedHarps, countIn: s.countIn, countEachLoop: s.countEachLoop }));
  } catch {
    /* storage unavailable */
  }
});

// Autosave the working document.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let autosaveFailed = false;
function saveWorking() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const s = useApp.getState();
  try {
    const store = local();
    if (!store) throw new Error('no storage');
    writeWorking(store, tabId, { text: s.text, docId: s.docId, savedText: s.savedText });
    autosaveFailed = false;
  } catch {
    // Storage full or blocked: say so once, so unsaved work isn't silently at risk.
    if (!autosaveFailed) s.notify('Couldn’t keep a backup of your working tab in this browser — save it to your library or export it.');
    autosaveFailed = true;
  }
}
useApp.subscribe((s, prev) => {
  if (s.text === prev.text && s.docId === prev.docId && s.savedText === prev.savedText) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWorking, 300);
});
// A duplicated browser tab starts with the same id: it moves to a new one (keeping its text).
if (typeof window !== 'undefined') {
  const stopWatching = watchForClash(
    () => tabId,
    () => {
      tabId = newSessionId();
      setSessionId(session(), tabId);
      saveWorking();
    },
  );
  // A hot reload (development) replaces this module: the old copy mustn't answer the new one.
  (import.meta as ImportMeta & { hot?: { dispose(fn: () => void): void } }).hot?.dispose(stopWatching);
}

// Don't lose the last keystrokes when the tab is closed or hidden.
if (typeof window !== 'undefined') {
  const flush = () => saveTimer !== undefined && saveWorking();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}

export function useParsed(): Parsed {
  const text = useApp((s) => s.text);
  return getParsed(text);
}

export function isDirty(s: Pick<AppState, 'text' | 'savedText'>): boolean {
  return s.text !== s.savedText;
}

// The keyboard's position along a long harmonica (← →) belongs to that harmonica: it
// starts over whenever the harmonica changes (picker, another tab, undo).
const harpIdOf = (text: string) => {
  const { spec, holes } = getParsed(text).harp;
  return `${spec.family}/${spec.tuning}/${spec.key}/${holes.length}`;
};
let harpId = harpIdOf(useApp.getState().text);
useApp.subscribe((s, prev) => {
  if (s.text === prev.text) return;
  const id = harpIdOf(s.text);
  if (id === harpId) return;
  harpId = id;
  if (s.keyOffset) useApp.setState({ keyOffset: 0 });
});
