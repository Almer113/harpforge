import { create } from 'zustand';
import { parseHtab } from '../core/htab/parser';
import type { ParseIssue, TabDoc } from '../core/htab/types';
import { harmonicaFromMeta, buildScore, eventKey, type Score } from '../core/score';
import type { Harmonica } from '../core/instruments';
import type { HoleSound } from '../core/types';
import { TWINKLE } from '../demo/songs';

export type Page = 'play' | 'editor' | 'convert' | 'library';
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

export type SheetView = 'tab' | 'staff' | 'numbers';

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
  samplesStatus: 'idle' | 'loading' | 'ready' | 'error';

  setPage(p: Page): void;
  setText(t: string): void;
  loadText(t: string, docId?: string | null, saved?: boolean): void;
  markSaved(docId: string): void;
  notify(message: string): void;
}

const initial = loadWorking();

const PREFS_KEY = 'harpforge:prefs';
function loadPrefs(): { soundMode?: 'samples' | 'synth' } {
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
  showNoteNames: true,
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
  samplesStatus: 'idle',

  setPage: (page) => set({ page }),
  setText: (text) => set({ text, selectedEvent: null }),
  loadText: (text, docId = null, saved = false) =>
    set({ text, docId, savedText: saved ? text : null, selectedEvent: null, activeEvents: [] }),
  markSaved: (docId) => set((s) => ({ docId, savedText: s.text })),
  notify: (message) => set({ toast: { message, id: Date.now() } }),
}));

// Remember preferences.
useApp.subscribe((s, prev) => {
  if (s.soundMode === prev.soundMode) return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ soundMode: s.soundMode }));
  } catch {
    /* storage unavailable */
  }
});

// Autosave the working document.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useApp.subscribe((s, prev) => {
  if (s.text === prev.text && s.docId === prev.docId && s.savedText === prev.savedText) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ text: s.text, docId: s.docId, savedText: s.savedText }));
    } catch {
      /* storage unavailable */
    }
  }, 300);
});

export function useParsed(): Parsed {
  const text = useApp((s) => s.text);
  return getParsed(text);
}

export function isDirty(s: Pick<AppState, 'text' | 'savedText'>): boolean {
  return s.text !== s.savedText;
}
