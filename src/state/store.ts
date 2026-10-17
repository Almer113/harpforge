import { BACKING_STYLES, type BackingStyle, type DroneRoot } from '../core/backing';
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
let parsedBefore: Parsed | null = null;

/** Parses .htab text into everything the views need (not cached). */
export function makeParsed(text: string): Parsed {
  const { doc, issues } = parseHtab(text);
  const harp = harmonicaFromMeta(doc.meta);
  const built = buildScore(doc, harp);
  const indexByKey = new Map<string, number>();
  for (const ev of built.score.events) indexByKey.set(eventKey(ev.line, ev.eventIndex), ev.index);
  return { text, doc, harp, score: built.score, issues: [...issues, ...built.issues], indexByKey };
}

/**
 * Parses the current text (memoized on the text). The one before is kept too: after an edit,
 * what changed is worked out from both, without parsing either again.
 */
export function getParsed(text: string): Parsed {
  if (parsedCache && parsedCache.text === text) return parsedCache;
  if (parsedBefore && parsedBefore.text === text) {
    [parsedCache, parsedBefore] = [parsedBefore, parsedCache];
    return parsedCache!;
  }
  parsedBefore = parsedCache;
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

export type SheetView = 'simple' | 'tab' | 'staff' | 'numbers' | 'lyrics';
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
  /** The verse the lyrics under the notes show and edit (0 = verse 1). */
  verse: number;
  /** Lyrics mode: the note whose syllable is being typed. */
  lyricAt?: import('../core/edit/model').Pos;
  /** A rest block being made in empty space, for words (lyrics mode) or a chord. */
  restDraft?: { pos: import('../core/edit/model').Pos; dur: number; field: 'lyric' | 'chord' };
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

/** The parts of the mix: the song's melody, its backing, the drone on its own, the metronome and count, and what you play. */
export type MixPart = 'tune' | 'backing' | 'drone' | 'clicks' | 'you';
export const MIX_PARTS: MixPart[] = ['tune', 'backing', 'drone', 'clicks', 'you'];

export interface Mix {
  /** The master volume (0–1). */
  master: number;
  /** Each part's level (0–1). */
  levels: Record<MixPart, number>;
  /** Parts switched off (their level is kept for when they're back on). */
  off: Record<MixPart, boolean>;
}

export const DEFAULT_MIX: Mix = {
  master: 1,
  levels: { tune: 1, backing: 0.7, drone: 0.7, clicks: 1, you: 1 },
  off: { tune: false, backing: false, drone: false, clicks: false, you: false },
};

/** A remembered mix, checked (anything that isn't a level or a switch goes back to the default). */
function mixFrom(raw: unknown): Mix | undefined {
  if (!isObject(raw)) return undefined;
  const level = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
  const levels = isObject(raw.levels) ? raw.levels : {};
  const off = isObject(raw.off) ? raw.off : {};
  return {
    master: level(raw.master, DEFAULT_MIX.master),
    levels: Object.fromEntries(MIX_PARTS.map((p) => [p, level(levels[p], DEFAULT_MIX.levels[p])])) as Record<MixPart, number>,
    off: Object.fromEntries(MIX_PARTS.map((p) => [p, off[p] === true])) as Record<MixPart, boolean>,
  };
}

/** One part of the mix on or off. */
export function setPartOff(part: MixPart, isOff: boolean) {
  useApp.setState((s) => (s.mix.off[part] === isOff ? {} : { mix: { ...s.mix, off: { ...s.mix.off, [part]: isOff } } }));
}

export interface PracticeState {
  /** Score index of the note to play next. */
  index: number;
  /** Where that is in the order played (repeats and endings): an index into the playback score. */
  at?: number;
  played: number;
  mistakes: number;
  startedAt: number;
  /** Time of the last wrong note (for a brief shake). */
  wrongAt: number;
  /** Wrong notes tried on each note (score index), for the practice report. */
  mistakesAt: Record<number, number>;
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
  /** The tempo trainer's settings (remembered): speeds as multipliers, step after `every` passes. */
  trainer: TrainerSettings;
  /** The tempo trainer while it runs: passes played, and whether it's holding the speed. */
  /** `counted`: the passes that count towards speeding up (only the clean ones, when it waits for those). */
  training: { pass: number; holding: boolean; counted?: number } | null;
  /** The trainer speeds up only after a pass played cleanly (when playing along). Remembered. */
  trainerCleanOnly: boolean;
  /** Play along, checked: what you play during playback is matched to the song's notes. */
  along: boolean;
  /** The microphone's delay in ms, from a calibration (null: not calibrated). Remembered. */
  micLatency: number | null;
  /** A microphone calibration is listening (Play ends it). */
  calibrating: boolean;
  /** Performance mode: the Play page's sheet fills the screen. */
  performing: boolean;
  /** How big the music is in performance mode (one of PERFORM_SIZES). Remembered. */
  performSize: number;
  /** How performance mode keeps up: smooth scrolling, or whole pages. Remembered. */
  performMove: 'scroll' | 'pages';
  /**
   * The mix: the master volume and each part's level, and which parts are off — the tune off
   * is how the music plays silently (performing) or leaves the microphone to hear just you
   * (playing along). Remembered.
   */
  mix: Mix;
  /** Backing chords from the song's chord symbols, and how they're played ('off': none). Remembered. */
  backing: 'off' | BackingStyle;
  /** The drone sounding on its own (see drone.ts). */
  droneOn: boolean;
  /** The drone's root (the song's key, the harmonica's, or a pitch class) and whether its fifth sounds. Remembered. */
  droneRoot: DroneRoot;
  droneFifth: boolean;
  /** Play |: … :| sections twice. Remembered. */
  playRepeats: boolean;
  /** While playing: 2 when the note playing is a repeat's second time. */
  playPass: number;
  /** Play the song once through for each verse. Remembered. */
  playAllVerses: boolean;
  /** While playing: the verse being sung (0 = verse 1). */
  playVerse: number;
  /** The tab line of the note last started while playing (null: none yet). */
  playLine: number | null;
  /** While playing: whether it goes through verses (all verses, or a repeat's verse 2). */
  playVerses: boolean;
  /** This pass's marks, by score index. */
  alongMarks: Record<number, import('../core/playAlong').Mark>;
  /** The last pass's marks (shown faded until each note comes round again). */
  alongPrev: Record<number, import('../core/playAlong').Mark>;
  /** Passes played along since it was turned on, newest last. */
  alongPasses: import('../core/playAlong').PassResult[];
  /** The practice report on screen: the session, and the song's earlier sessions. */
  report: { session: import('../core/report').SessionReport; history: import('../storage/practiceLog').LogEntry[]; title: string; at: number } | null;
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
  toast: { message: string; id: number; action?: ToastAction } | null;
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
  /** The verse the sheet shows (1, 2…), or 0 for all of them. */
  showVerse: number;
  /** The harmonicas you own (remembered): import ranks them first. */
  ownedHarps: import('../core/instruments').HarmonicaSpec[];
  /** The library tab whose History dialog is open. */
  historyFor: string | null;
  /** Saves to the library still on their way (closing the page now would lose them). */
  savesPending: number;
  /** Whose library the open song's docId is in ("browser", or "account:<name>"): kept with the working copy. */
  libraryOwner: string;
  /** Who's signed in here: the library is theirs (on the server), or this browser's (a guest). */
  account: { status: 'checking' | 'guest' | 'signed-in' | 'signed-out' | 'offline'; name?: string };
  /** The start screen (sign in, create an account, or go on as a guest), and which form it shows. */
  accountGate: 'signin' | 'signup' | null;
  /** Bringing this browser's songs into the account just signed in to: how many there are. */
  bringOffer: { name: string; songs: number; trashed: number } | null;
  /** The open tab is in the library's trash (saving it brings it back). */
  inTrash: boolean;
  /** Counts changes to the library made outside the library page (an undo), so it reads it again. */
  libraryRev: number;
  /** Plain-text export: open, and its choices (remembered). */
  plainTextOpen: boolean;
  /** The editor's "Fill lyrics from text" dialog, and the words in it (kept if it's closed by mistake). */
  fillLyricsOpen: boolean;
  fillDraft: string;
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
  /** A message at the bottom; with an action, a button in it (e.g. Undo). */
  notify(message: string, action?: ToastAction): void;
}

const initial = loadWorking();

const PREFS_KEY = 'harpforge:prefs';
export type ReadAs = 'holes' | 'notes';
export interface SheetShow {
  /** `holes`: the small holes under the notes in Notes mode (note names in Holes mode = showNoteNames). */
  tab: { lyrics: boolean; chords: boolean; holes: boolean };
  numbers: { holes: boolean; lyrics: boolean; chords: boolean };
  staff: { holes: boolean; lyrics: boolean; chords: boolean; header: boolean };
  /** `holes`: the holes (or notes) above the words. */
  lyrics: { holes: boolean; chords: boolean };
}
const SHOW_ALL: SheetShow = {
  tab: { lyrics: true, chords: true, holes: true },
  numbers: { holes: true, lyrics: true, chords: true },
  // The page already shows the title and tempo, so the staff leaves them out unless asked.
  staff: { holes: true, lyrics: true, chords: true, header: false },
  lyrics: { holes: true, chords: true },
};

export interface TrainerSettings {
  start: number;
  step: number;
  every: number;
  goal: number;
}
export const DEFAULT_TRAINER: TrainerSettings = { start: 0.6, step: 0.05, every: 1, goal: 1 };
/** The trainer's choices (what its menu offers). */
export const TRAINER_CHOICES = {
  start: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
  step: [0.02, 0.05, 0.1],
  every: [1, 2, 3],
  goal: [0.8, 0.9, 1, 1.1, 1.2],
};

/** Performance mode's music sizes (A− / A+ step through them). */
export const PERFORM_SIZES = [1, 1.15, 1.3, 1.5, 1.75, 2, 2.5];
export const DEFAULT_PERFORM_SIZE = 1.3;

/** Remembered trainer settings, each one of its allowed values. */
function trainerFrom(v: unknown): Partial<TrainerSettings> {
  if (!isObject(v)) return {};
  const out: Partial<TrainerSettings> = {};
  for (const k of Object.keys(TRAINER_CHOICES) as (keyof TrainerSettings)[]) {
    const x = v[k];
    if (typeof x === 'number' && TRAINER_CHOICES[k].some((c) => Math.abs(c - x) < 1e-9)) out[k] = x;
  }
  return out;
}

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
  trainer?: Partial<TrainerSettings>;
  trainerCleanOnly?: boolean;
  micLatency?: number;
  performSize?: number;
  performMove?: 'scroll' | 'pages';
  mix?: Mix;
  backing?: 'off' | BackingStyle;
  droneRoot?: DroneRoot;
  droneFifth?: boolean;
  playRepeats?: boolean;
  playAllVerses?: boolean;
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
  if (print.view !== undefined && !['simple', 'tab', 'staff', 'numbers', 'lyrics'].includes(print.view)) delete print.view;
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
    trainer: trainerFrom(p.trainer),
    trainerCleanOnly: bool(p.trainerCleanOnly),
    micLatency: typeof p.micLatency === 'number' && p.micLatency >= 0 && p.micLatency <= 600 ? Math.round(p.micLatency) : undefined,
    performSize: PERFORM_SIZES.find((x) => x === p.performSize),
    performMove: p.performMove === 'pages' || p.performMove === 'scroll' ? p.performMove : undefined,
    mix: mixFrom(p.mix),
    droneRoot: p.droneRoot === 'song' || p.droneRoot === 'harp' ? p.droneRoot : typeof p.droneRoot === 'number' && Number.isInteger(p.droneRoot) && p.droneRoot >= 0 && p.droneRoot < 12 ? p.droneRoot : undefined,
    droneFifth: bool(p.droneFifth),
    backing: p.backing === 'off' || BACKING_STYLES.some((b) => b.id === p.backing) ? (p.backing as 'off' | BackingStyle) : undefined,
    playRepeats: bool(p.playRepeats),
    playAllVerses: bool(p.playAllVerses),
    readAs: p.readAs === 'notes' ? 'notes' : p.readAs === 'holes' ? 'holes' : undefined,
    sheetShow: { tab: like(sheet.tab, SHOW_ALL.tab), numbers: like(sheet.numbers, SHOW_ALL.numbers), staff: like(sheet.staff, SHOW_ALL.staff), lyrics: like(sheet.lyrics, SHOW_ALL.lyrics) },
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
  libraryOwner: initial.owner ?? 'browser',
  savesPending: 0,
  play: 'stopped',
  activeEvents: [],
  selectedEvent: null,
  passage: null,
  loop: false,
  loopRange: null,
  metronome: false,
  countIn: prefs.countIn ?? false,
  countEachLoop: prefs.countEachLoop ?? false,
  trainer: { ...DEFAULT_TRAINER, ...prefs.trainer },
  training: null,
  trainerCleanOnly: prefs.trainerCleanOnly ?? false,
  along: false,
  micLatency: prefs.micLatency ?? null,
  performing: false,
  performSize: prefs.performSize ?? DEFAULT_PERFORM_SIZE,
  performMove: prefs.performMove ?? 'scroll',
  mix: prefs.mix ?? DEFAULT_MIX,
  backing: prefs.backing ?? 'off',
  droneOn: false,
  droneRoot: prefs.droneRoot ?? 'song',
  droneFifth: prefs.droneFifth ?? true,
  playRepeats: prefs.playRepeats ?? true,
  playPass: 1,
  playAllVerses: prefs.playAllVerses ?? false,
  playVerse: 0,
  playLine: null,
  playVerses: false,
  calibrating: false,
  alongMarks: {},
  alongPrev: {},
  alongPasses: [],
  report: null,
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
  showVerse: 0,
  importDraft: null,
  mic: { status: 'off', level: 0, reading: null },
  micSensitivity: 0.7,
  midi: { status: 'off', devices: [] },
  practice: null,
  soundMode: prefs.soundMode === 'synth' ? 'synth' : 'samples',
  harpSize: prefs.harpSize ?? 'full',
  printPrefs: { view: 'tab', size: 'normal', title: true, details: true, chart: false, ...prefs.printPrefs },
  historyFor: null,
  account: { status: 'checking' },
  accountGate: null,
  bringOffer: null,
  inTrash: false,
  libraryRev: 0,
  plainTextOpen: false,
  fillLyricsOpen: false,
  fillDraft: '',
  ownedHarps: Array.isArray(prefs.ownedHarps) ? prefs.ownedHarps : [],
  textPrefs: { ...DEFAULT_PLAIN_TEXT, ...prefs.textPrefs },
  sheetShow: {
    tab: { ...SHOW_ALL.tab, ...prefs.sheetShow?.tab },
    numbers: { ...SHOW_ALL.numbers, ...prefs.sheetShow?.numbers },
    staff: { ...SHOW_ALL.staff, ...prefs.sheetShow?.staff },
    lyrics: { ...SHOW_ALL.lyrics, ...prefs.sheetShow?.lyrics },
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
    verse: 0,
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
  // (A song from the library: from the library in use now — the working copy notes whose.)
  loadText: (text, docId = null, saved = false) =>
    // A different tab: the editor's caret and selection start over (they belonged to the old one).
    set((s) => ({ ve: { ...s.ve, selection: [], anchor: undefined, panel: undefined, justEntered: undefined, caret: { m: 0, start: 0 }, measure: 0, verse: 0, lyricAt: undefined, restDraft: undefined }, showVerse: 0, fillLyricsOpen: false, loadSeq: s.loadSeq + 1, inTrash: false, libraryOwner: docId ? libraryInUse(s) : s.libraryOwner, text, docId, savedText: saved ? text : null, selectedEvent: null, passage: null, loopRange: null, loop: s.loopRange ? false : s.loop, training: null, alongMarks: {}, alongPrev: {}, alongPasses: [], activeEvents: [], history: { past: [], future: [], lastKind: '', lastAt: 0, groupAt: 0 } })),
  markSaved: (docId, text) => set((s) => ({ docId, savedText: text ?? s.text, inTrash: false })),
  notify: (message, action) => set((s) => ({ toast: { message, id: Math.max(Date.now(), (s.toast?.id ?? 0) + 1), action } })),
}));

// Remember preferences.
useApp.subscribe((s, prev) => {
  if (s.soundMode === prev.soundMode && s.harpSize === prev.harpSize && s.fitWidth === prev.fitWidth && s.dockOpen === prev.dockOpen && s.ve.zoom === prev.ve.zoom && s.showNoteNames === prev.showNoteNames && s.readAs === prev.readAs && s.sheetShow === prev.sheetShow && s.printPrefs === prev.printPrefs && s.textPrefs === prev.textPrefs && s.ownedHarps === prev.ownedHarps && s.countIn === prev.countIn && s.countEachLoop === prev.countEachLoop && s.trainer === prev.trainer && s.trainerCleanOnly === prev.trainerCleanOnly && s.micLatency === prev.micLatency && s.performSize === prev.performSize && s.performMove === prev.performMove && s.mix === prev.mix && s.backing === prev.backing && s.droneRoot === prev.droneRoot && s.droneFifth === prev.droneFifth && s.playRepeats === prev.playRepeats && s.playAllVerses === prev.playAllVerses) return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ soundMode: s.soundMode, harpSize: s.harpSize, fitWidth: s.fitWidth, dockOpen: s.dockOpen, zoom: s.ve.zoom, showNoteNames: s.showNoteNames, readAs: s.readAs, sheetShow: s.sheetShow, printPrefs: s.printPrefs, textPrefs: s.textPrefs, ownedHarps: s.ownedHarps, countIn: s.countIn, countEachLoop: s.countEachLoop, trainer: s.trainer, trainerCleanOnly: s.trainerCleanOnly, micLatency: s.micLatency ?? undefined, performSize: s.performSize, performMove: s.performMove, mix: s.mix, backing: s.backing, droneRoot: s.droneRoot, droneFifth: s.droneFifth, playRepeats: s.playRepeats, playAllVerses: s.playAllVerses }));
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
    writeWorking(store, tabId, { text: s.text, docId: s.docId, savedText: s.savedText, owner: s.libraryOwner });
    autosaveFailed = false;
  } catch {
    // Storage full or blocked: say so once, so unsaved work isn't silently at risk.
    if (!autosaveFailed) s.notify('Couldn’t keep a backup of your working tab in this browser — save it to your library or export it.');
    autosaveFailed = true;
  }
}
useApp.subscribe((s, prev) => {
  if (s.text === prev.text && s.docId === prev.docId && s.savedText === prev.savedText && s.libraryOwner === prev.libraryOwner) return;
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

/** Whose library a song's id belongs to, as the working copy keeps it ("browser", or "account:<name>"). */
export const ownerOf = (name: string | null | undefined) => (name ? `account:${name.toLowerCase()}` : 'browser');

/** Whose library is in use now (a signed-in account's, else this browser's). */
export function libraryInUse(s: Pick<AppState, 'account'>): string {
  return s.account.status === 'signed-in' || s.account.status === 'signed-out' ? ownerOf(s.account.name) : 'browser';
}

/** A button in a message: what it says, and what it does. */
export interface ToastAction {
  label: string;
  run: () => void;
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
