import { create } from 'zustand';
import { parseHtab } from '../core/htab/parser';
import type { ParseIssue, TabDoc } from '../core/htab/types';
import { harmonicaFromMeta, buildScore, eventKey, type Score } from '../core/score';
import type { Harmonica } from '../core/instruments';
import type { HoleSound } from '../core/types';
import { TWINKLE } from '../demo/songs';

export type Page = 'play' | 'editor' | 'library';
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

const AUTOSAVE_KEY = 'harpforge:working';

function loadWorking(): { text: string; docId: string | null; savedText: string | null } {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (typeof v.text === 'string') return { text: v.text, docId: v.docId ?? null, savedText: v.savedText ?? null };
    }
  } catch {
    /* storage unavailable */
  }
  return { text: TWINKLE, docId: null, savedText: TWINKLE };
}

export type SheetView = 'simple' | 'tab' | 'staff' | 'numbers';
export type EditorMode = 'visual' | 'text' | 'split';

/** Visual editor UI state. Positions are (measure index, start beat). */
export interface VisualState {
  selection: import('../core/edit/model').Pos[];
  caret: import('../core/edit/model').Pos;
  /** Measure shown in the inspector when no note is selected. */
  measure: number;
  /** Duration tool for new notes: base value in beats, dotted, triplet. */
  dur: number;
  dotted: boolean;
  triplet: boolean;
  snap: number;
  zoom: number;
  /** Step entry: playing a hole inserts it at the caret. */
  step: boolean;
  /** Sound used for notes added without the harmonica. */
  lastSounds: import('../core/types').Sound[];
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
  loop: boolean;
  metronome: boolean;
  /** Playback speed multiplier (practice slow-down). */
  speed: number;
  /** Live-held sounds by input id (mouse, key codes). */
  held: Record<string, HoleSound>;
  /** First hole mapped to the keyboard rows (for harmonicas with > 12 holes). */
  keyOffset: number;
  /** Chromatic slide button latched on (mouse / button). */
  slideLatch: boolean;
  showNoteNames: boolean;
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
  /** Play page: the harmonica is folded away (the keyboard still plays). */
  harpHidden: boolean;
  /** Visual editor: measures fill each row (true) or follow the text's lines. */
  fitWidth: boolean;
  editorMode: EditorMode;
  ve: VisualState;
  setVe(patch: Partial<VisualState>): void;
  samplesStatus: 'idle' | 'loading' | 'ready' | 'error';

  setPage(p: Page): void;
  /** Changes the tab text and records an undo step ('typing' groups quick keystrokes). */
  setText(t: string, opts?: { kind?: 'typing' | 'edit' }): void;
  undo(): void;
  redo(): void;
  history: { past: HistoryEntry[]; future: HistoryEntry[]; lastKind: string; lastAt: number; groupAt: number };
  loadText(t: string, docId?: string | null, saved?: boolean): void;
  /** Marks `text` (what was actually written to the library) as saved under `docId`. */
  markSaved(docId: string, text?: string): void;
  notify(message: string): void;
}

const initial = loadWorking();

const PREFS_KEY = 'harpforge:prefs';
export interface SheetShow {
  tab: { lyrics: boolean; chords: boolean };
  numbers: { holes: boolean; lyrics: boolean; chords: boolean };
  staff: { holes: boolean; lyrics: boolean; chords: boolean; header: boolean };
}
const SHOW_ALL: SheetShow = {
  tab: { lyrics: true, chords: true },
  numbers: { holes: true, lyrics: true, chords: true },
  // The page already shows the title and tempo, so the staff leaves them out unless asked.
  staff: { holes: true, lyrics: true, chords: true, header: false },
};

function loadPrefs(): { soundMode?: 'samples' | 'synth'; harpHidden?: boolean; fitWidth?: boolean; showNoteNames?: boolean; sheetShow?: Partial<SheetShow> } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
  } catch {
    return {};
  }
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
  loop: false,
  metronome: false,
  speed: 1,
  held: {},
  keyOffset: 0,
  slideLatch: false,
  showNoteNames: prefs.showNoteNames ?? true,
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
  harpHidden: !!prefs.harpHidden,
  sheetShow: {
    tab: { ...SHOW_ALL.tab, ...prefs.sheetShow?.tab },
    numbers: { ...SHOW_ALL.numbers, ...prefs.sheetShow?.numbers },
    staff: { ...SHOW_ALL.staff, ...prefs.sheetShow?.staff },
  },
  fitWidth: prefs.fitWidth !== false,
  editorMode: 'visual',
  ve: {
    selection: [],
    caret: { m: 0, start: 0 },
    measure: 0,
    dur: 1,
    dotted: false,
    triplet: false,
    snap: 0.5,
    zoom: 64,
    step: false,
    lastSounds: [{ type: 'hole', hole: 4, breath: 'blow', bend: 0, over: false, slide: false }],
  },
  setVe: (patch) => set((s) => ({ ve: { ...s.ve, ...patch } })),
  samplesStatus: 'idle',

  setPage: (page) => set({ page }),
  setText: (text, opts) =>
    set((s) => {
      if (text === s.text) return {};
      const kind = opts?.kind ?? 'edit';
      const now = Date.now();
      const h = s.history;
      // Quick keystrokes make one undo step, but not forever: a step covers at most a few seconds.
      const merge = kind === 'typing' && h.lastKind === 'typing' && now - h.lastAt < 1200 && now - h.groupAt < 5000;
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
  loadText: (text, docId = null, saved = false) =>
    set({ text, docId, savedText: saved ? text : null, selectedEvent: null, activeEvents: [], history: { past: [], future: [], lastKind: '', lastAt: 0, groupAt: 0 } }),
  markSaved: (docId, text) => set((s) => ({ docId, savedText: text ?? s.text })),
  notify: (message) => set({ toast: { message, id: Date.now() } }),
}));

// Remember preferences.
useApp.subscribe((s, prev) => {
  if (s.soundMode === prev.soundMode && s.harpHidden === prev.harpHidden && s.fitWidth === prev.fitWidth && s.showNoteNames === prev.showNoteNames && s.sheetShow === prev.sheetShow) return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ soundMode: s.soundMode, harpHidden: s.harpHidden, fitWidth: s.fitWidth, showNoteNames: s.showNoteNames, sheetShow: s.sheetShow }));
  } catch {
    /* storage unavailable */
  }
});

// Autosave the working document.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let autosaveFailed = false;
function writeWorking() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const s = useApp.getState();
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ text: s.text, docId: s.docId, savedText: s.savedText }));
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
  saveTimer = setTimeout(writeWorking, 300);
});
// Don't lose the last keystrokes when the tab is closed or hidden.
if (typeof window !== 'undefined') {
  const flush = () => saveTimer !== undefined && writeWorking();
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
