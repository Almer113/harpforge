// Practice history: a line per session for each song in your library, kept in this
// browser, so the report can show how you're getting on (the last 20 sessions a song).

import { accuracy, type SessionReport } from '../core/report';

export interface LogEntry {
  at: number;
  mode: SessionReport['mode'];
  /** 0–100 (see accuracy()). */
  accuracy: number;
  passes: number;
  clean: number;
  /** The holes missed most that session. */
  holes: string[];
}

const KEY = 'harpforge:practice-log';
const PER_SONG = 20;
const SONGS = 200;

type Log = Record<string, LogEntry[]>;

function read(): Log {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    // (A song's entry that isn't a list is from something else: it's dropped.)
    return Object.fromEntries(Object.entries(v).filter(([, list]) => Array.isArray(list))) as Log;
  } catch {
    return {};
  }
}

/** A song's sessions, oldest first. */
export function songLog(docId: string): LogEntry[] {
  const list = read()[docId];
  return Array.isArray(list) ? list.filter((e) => e && typeof e.at === 'number' && typeof e.accuracy === 'number') : [];
}

/** Adds a session to a song's history (the songs practised longest ago drop off past 200). */
export function logSession(docId: string, r: SessionReport, at = Date.now()) {
  const log = read();
  const entry: LogEntry = { at, mode: r.mode, accuracy: accuracy(r), passes: r.passes, clean: r.clean, holes: r.holes.filter((h) => h.misses > 0).slice(0, 3).map((h) => h.label) };
  log[docId] = [...songLog(docId), entry].slice(-PER_SONG);
  const songs = Object.entries(log).sort((a, b) => (b[1].at(-1)?.at ?? 0) - (a[1].at(-1)?.at ?? 0)).slice(0, SONGS);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(songs)));
  } catch {
    /* storage full or unavailable: the report still shows */
  }
}
