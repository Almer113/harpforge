// User-level actions shared by several pages.

import { guessTonic, positionFor, positionName, retab, transposeDoc } from '../core/convert';
import { setMetaFields } from '../core/htab/meta';
import { splitHeader } from '../core/htab/parser';
import { keptMessage, replaceLines, type SpliceReport } from '../core/edit/splice';
import { keyUsesFlats } from '../core/pitch';
import { getHarmonica, specId, type HarmonicaSpec } from '../core/instruments';
import { BLANK } from '../demo/songs';
import { isChordSheet, octaveOptions } from '../core/convert';
import type { Imported } from '../core/formats';
import { FORMAT_NAMES, IMPORT_ACCEPT, type ExportKind } from '../core/formats/catalog';

/**
 * The format readers and writers, loaded the first time they're needed (or in the
 * background soon after the page opens: see preloadFormats). Null, with a message, when
 * they can't be downloaded; the next try downloads again.
 */
const formats = () =>
  import('../core/formats').catch(() => {
    useApp.getState().notify('The file readers couldn’t be loaded. Check your connection, then try again.');
    return null;
  });

/**
 * Fetches the format readers in the background, so an export's download starts right
 * from the click (Safari blocks downloads started too long after one).
 */
export function preloadFormats(): void {
  import('../core/formats').catch(() => {});
}
import { libraryNow, persistStorage, SaveClash, saveTab } from '../storage/library';
import type { LibraryBackend } from '../storage/types';
import { stop } from './playback';
import { finishRecording } from '../live/recorder';
import { getParsed, isDirty, libraryInUse, useApp } from './store';

/** Whether switching to `spec` is only a key change (same holes, other pitches), so the user can choose. */
export function isKeyChange(spec: HarmonicaSpec): boolean {
  const p = getParsed(useApp.getState().text);
  const sameLayout = spec.family === p.harp.spec.family && spec.tuning === p.harp.spec.tuning && spec.key !== p.harp.spec.key;
  return sameLayout && p.doc.lines.some((l) => l.events.some((e) => e.kind === 'note'));
}

/** Semitones between two harps of the same layout (Low/High keys included). */
export function keyDistance(from: HarmonicaSpec, to: HarmonicaSpec): number {
  return getHarmonica(to).holes[0].blow - getHarmonica(from).holes[0].blow;
}

/**
 * Switches the document's harmonica.
 * - `holes`: keep the tab as it is (only possible within the same layout); the music
 *   moves to the new key, and the song key and chord symbols move with it.
 * - `notes`: keep the music; the tab is rewritten for the new harmonica.
 * Changing family or tuning always keeps the notes.
 */
export function setHarmonica(spec: HarmonicaSpec, keep: 'holes' | 'notes' = 'notes') {
  // A recording in progress goes into the tab first, so it's re-tabbed with the rest.
  finishRecording();
  const s = useApp.getState();
  const p = getParsed(s.text);
  const to = getHarmonica(spec);
  if (specId(to.spec) === specId(p.harp.spec)) return;
  const fields: Record<string, string | number | undefined> = { harmonica: to.spec.family, tuning: to.spec.tuning, harpKey: to.spec.key };
  const sameLayout = to.spec.family === p.harp.spec.family && to.spec.tuning === p.harp.spec.tuning;
  const header = s.text.slice(0, splitHeader(s.text).bodyStart);
  stop();
  useApp.setState({ keyOffset: 0 });
  if (sameLayout && keep === 'holes') {
    const semis = keyDistance(p.harp.spec, to.spec);
    const moved = transposeDoc(p.doc, semis);
    if (moved.meta.key) fields.key = moved.meta.key;
    const report: SpliceReport = { kept: [] };
    const body = replaceLines(s.text, moved.lines, keyUsesFlats(moved.meta.key ?? to.spec.key), report);
    s.setText(setMetaFields(header, fields) + body + (body ? '\n' : ''));
    if (p.doc.lines.some((l) => l.events.some((e) => e.kind === 'note')))
      s.notify(`Same holes on ${to.name}${moved.meta.key ? ` — the song is now in ${moved.meta.key}` : ''}, chords moved too.${withKept(report)}`);
    return;
  }
  // Reading in notes, the notes stay in their octave if they fit.
  const r = retab(p.doc, p.harp, to, s.readAs === 'notes');
  // The song stays in its key, so its position on the new harp changes.
  const tonic = guessTonic(p.doc, p.harp);
  if (p.doc.meta.position !== undefined) fields.position = tonic !== undefined && to.spec.family !== 'chromatic' ? positionName(positionFor(to.spec.key, tonic)!) : undefined;
  // Only the lines whose notes changed are rewritten; comments and spacing stay.
  const report: SpliceReport = { kept: [] };
  const body = replaceLines(s.text, r.doc.lines, undefined, report);
  s.setText(setMetaFields(header, fields) + body + (body ? '\n' : ''));
  if (r.stats.unplayable)
    s.notify(`Re-tabbed for ${to.name}, but ${r.stats.unplayable} note${r.stats.unplayable === 1 ? '' : 's'} didn't fit: ${r.warnings.slice(0, 2).join('; ')}${r.warnings.length > 2 ? '; …' : ''}.${withKept(report)}`);
  else if (r.warnings.length) s.notify(`Re-tabbed for ${to.name} — ${r.warnings.join('; ')}.${withKept(report)}`);
  else if (r.stats.notes) s.notify(`Re-tabbed for ${to.name} ✓${withKept(report)}`);
}

/** Moves the whole tab an octave up (+12) or down (−12) on the same harmonica, if it fits. */
export function shiftOctave(shift: 12 | -12) {
  finishRecording();
  const s = useApp.getState();
  const p = getParsed(s.text);
  const opt = octaveOptions(p.doc, p.harp).find((o) => o.shift === shift);
  if (!opt?.possible || !opt.result) {
    s.notify(opt?.note ?? 'Can’t move this tab.');
    return;
  }
  stop();
  const header = s.text.slice(0, splitHeader(s.text).bodyStart);
  const report: SpliceReport = { kept: [] };
  const body = replaceLines(s.text, opt.result.doc.lines, undefined, report);
  s.setText(header + body + (body ? '\n' : ''));
  s.notify(`Moved an octave ${shift > 0 ? 'up' : 'down'} ✓${withKept(report)}`);
}

/** " Kept “x” in a comment…" after a message, when a rewrite kept unreadable tokens. */
function withKept(report: SpliceReport): string {
  const m = keptMessage(report);
  return m ? ` ${m}` : '';
}

export function confirmDiscard(): boolean {
  // A recording in progress is written into the current tab first, so the question covers it.
  finishRecording();
  const s = useApp.getState();
  if (!isDirty(s) || s.text.trim() === BLANK.trim()) return true;
  return window.confirm('Your current tab has unsaved changes. Discard them?');
}

/** Opens a blank tab (after asking about unsaved changes). False if you kept the open one. */
export function newTab(): boolean {
  if (!confirmDiscard()) return false;
  stop();
  useApp.getState().loadText(BLANK);
  return true;
}

// Saves run one after another, so two quick saves of a new tab make one library entry.
let saveQueue: Promise<void> = Promise.resolve();
/** Library id given to each opened tab (by loadSeq) by a save, for a save queued behind it. */
const savedIds = new Map<number, string>();

/** Saves the open tab to the library (as a new entry with `asCopy`). */
export function saveCurrent(asCopy = false): Promise<void> {
  const s = useApp.getState();
  // What to save is decided now; where in the library it goes, when it's its turn. Which
  // library: the one in use now (once it's known whose — at startup, it's still being asked),
  // whatever happens meanwhile; if that changes before it's done, it's not this song's any more.
  const job = { text: s.text, seq: s.loadSeq, docId: s.docId, asCopy };
  const into = libraryNow();
  const run = saveQueue.then(async () => saveNow({ ...job, into: await into }));
  saveQueue = run.catch(() => undefined);
  return run;
}

async function saveNow(job: { text: string; seq: number; docId: string | null; asCopy: boolean; into: LibraryBackend }) {
  const s = useApp.getState();
  const owner = job.into.owner;
  const stillOpen = () => useApp.getState().loadSeq === job.seq && libraryInUse(useApp.getState()) === owner;
  const id0 = job.asCopy ? null : stillOpen() ? useApp.getState().docId : (savedIds.get(job.seq) ?? job.docId);
  try {
    // (What this window last saved or opened: if the library has something else now, it was saved elsewhere.)
    const expect = !job.asCopy && stillOpen() ? useApp.getState().savedText : null;
    let id: string;
    try {
      id = await saveTab(job.text, id0, { expect, in: job.into });
    } catch (e) {
      if (!(e instanceof SaveClash)) throw e;
      const title = e.saved.title;
      if (!window.confirm(`“${title}” was saved from another window (or updated) since you opened it here. Save yours over it?\n\nThe other one stays in the tab’s history.`)) {
        s.notify('Not saved. Save a copy to keep both.');
        return;
      }
      id = await saveTab(job.text, id0, { in: job.into });
    }
    if (!job.asCopy) savedIds.set(job.seq, id);
    // (The library page, and the History dialog, read it again.)
    useApp.setState((st) => ({ libraryRev: st.libraryRev + 1 }));
    if (stillOpen()) {
      s.markSaved(id, job.text);
      useApp.setState({ libraryOwner: owner });
      s.notify(job.asCopy ? 'Saved a copy to your library ✓' : 'Saved to your library ✓');
    } else {
      // Another tab was opened while saving: the save is done, but it isn't this tab's.
      const title = getParsed(job.text).doc.meta.title || 'Untitled';
      s.notify(`Saved “${title}” to your library ✓`);
    }
    void persistStorage();
  } catch (e) {
    s.notify(`Couldn’t save to your library (${(e as Error).message || 'storage unavailable'}). Export the tab to keep it.`);
  }
}

export function downloadData(filename: string, data: string | Uint8Array, type = 'text/plain') {
  const part: BlobPart = typeof data === 'string' ? data : new Uint8Array(data);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Exports a tab (the current one by default) in any supported format. */
export async function exportAs(kind: ExportKind, text = useApp.getState().text) {
  const p = getParsed(text);
  try {
    const f = await formats();
    if (!f) return;
    const { filename, data, mime } = f.exportDoc(kind, p.doc, p.harp, text);
    downloadData(filename, data, mime);
  } catch (e) {
    useApp.getState().notify(`Export failed: ${(e as Error).message}`);
  }
}

/** True when an .htab only holds pitches (no holes): it should go through conversion. */
function isPitchOnly(imported: Imported): boolean {
  let pitches = 0;
  for (const l of imported.doc.lines) {
    for (const e of l.events) {
      if (e.kind !== 'note') continue;
      if (e.sounds.some((s) => s.type === 'hole')) return false;
      pitches++;
    }
  }
  return pitches > 0;
}

/** Imports a file: tabs load directly, everything else goes through the import dialog. */
export async function importFromFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const f = await formats();
  if (!f) return;
  const { decodeText, detectKind, importBytes } = f;
  if (detectKind(file.name, bytes) === 'pdf') {
    await importPdfFile(file.name, bytes);
    return;
  }
  let imported: ReturnType<typeof importBytes>;
  try {
    imported = importBytes(file.name, bytes);
  } catch (e) {
    useApp.setState({ importDraft: { name: file.name, error: (e as Error).message } });
    return;
  }
  if (imported.kind === 'htab' && !isChordSheet(imported.doc) && !isPitchOnly(imported)) {
    loadTabText(decodeText(bytes), file.name);
    return;
  }
  useApp.setState({ importDraft: { name: file.name, imported } });
}

/** Opens a file picker and imports the chosen file. */
export function importFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = IMPORT_ACCEPT;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void importFromFile(file);
  };
  input.click();
}

let pdfRuns = 0;

async function importPdfFile(name: string, bytes: Uint8Array) {
  const f = await formats();
  if (!f) return;
  const { importText, sniffText } = f;
  // Each reading has its own number: after a cancel, a new import (even of a file with the
  // same name) never shows the old reading's progress or result.
  const run = ++pdfRuns;
  const stillOpen = () => useApp.getState().importDraft?.run === run;
  useApp.setState({ importDraft: { name, run, progress: { message: 'Opening PDF…', fraction: 0 } } });
  try {
    const { readPdf } = await import('../core/formats/pdf');
    const res = await readPdf(bytes, (message, fraction) => {
      const d = useApp.getState().importDraft;
      if (d?.run === run && d.progress) useApp.setState({ importDraft: { ...d, progress: { message, fraction } } });
    });
    if (!stillOpen()) return;
    if (!res.text.trim()) throw new Error('No text could be found in this PDF.');
    const sniffed = sniffText(res.text);
    const kind = sniffed === 'htab' ? 'chordsheet' : sniffed;
    const imp = importText(res.text, kind);
    const hasContent = imp.doc.lines.some((l) => l.events.some((e) => e.kind === 'note' || (e.kind === 'rest' && e.chord)));
    if (!hasContent) throw new Error('Couldn’t find chords or tab in this PDF. You can paste its text instead (Paste…).');
    imp.format = `PDF → ${FORMAT_NAMES[kind]}`;
    if (res.ocrPages) {
      imp.warnings.unshift(
        `${res.ocrPages === res.pages ? 'This PDF is made of images' : `${res.ocrPages} page(s) are images`}, so the text was recognised by OCR — check the chords and lyrics (or edit the recognised text).`,
      );
    }
    useApp.setState({ importDraft: { name, run, imported: { ...imp, kind }, sourceText: res.text } });
  } catch (e) {
    if (stillOpen()) useApp.setState({ importDraft: { name, run, error: (e as Error).message } });
  }
}

/** Opens the import dialog in paste mode. */
export function openPasteImport() {
  useApp.setState({ importDraft: { name: 'Pasted text', pasteText: '' } });
}

/** Loads tab text as the current tab. `unchanged` marks it as having no edits yet (e.g. opened from a link). */
/** Opens a tab's text (asking first if there are unsaved changes). Returns false if the user kept their tab. */
export function loadTabText(text: string, name: string, opts: { unchanged?: boolean; message?: string } = {}): boolean {
  if (!confirmDiscard()) return false;
  stop();
  const s = useApp.getState();
  s.loadText(text, null, !!opts.unchanged);
  const { issues } = getParsed(text);
  const errors = issues.filter((i) => i.severity === 'error').length;
  s.notify(errors ? `Imported "${name}" with ${errors} problem(s) — see the editor.` : opts.message ?? `Imported "${name}" ✓`);
  return true;
}
