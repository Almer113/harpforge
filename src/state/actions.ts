// User-level actions shared by several pages.

import { retab } from '../core/convert';
import { setMetaFields } from '../core/htab/meta';
import { splitHeader } from '../core/htab/parser';
import { replaceLines } from '../core/edit/splice';
import { getHarmonica, specId, type HarmonicaSpec } from '../core/instruments';
import { BLANK } from '../demo/songs';
import { isChordSheet, octaveOptions } from '../core/convert';
import { decodeText, detectKind, exportDoc, FORMAT_NAMES, importBytes, IMPORT_ACCEPT, importText, sniffText, type ExportKind, type Imported } from '../core/formats';
import { persistStorage, saveTab } from '../storage/library';
import { stop } from './playback';
import { getParsed, isDirty, useApp } from './store';

/**
 * Switches the document's harmonica. Changing only the key keeps the holes (the
 * classic way tabs transpose); changing family or tuning re-tabs to keep the pitches.
 */
export function setHarmonica(spec: HarmonicaSpec) {
  const s = useApp.getState();
  const p = getParsed(s.text);
  const to = getHarmonica(spec);
  if (specId(to.spec) === specId(p.harp.spec)) return;
  const fields = { harmonica: to.spec.family, tuning: to.spec.tuning, harpKey: to.spec.key };
  const sameLayout = to.spec.family === p.harp.spec.family && to.spec.tuning === p.harp.spec.tuning;
  stop();
  if (sameLayout) {
    s.setText(setMetaFields(s.text, fields));
    useApp.setState({ keyOffset: 0 });
    return;
  }
  const r = retab(p.doc, p.harp, to);
  const header = s.text.slice(0, splitHeader(s.text).bodyStart);
  // Only the lines whose notes changed are rewritten; comments and spacing stay.
  const body = replaceLines(s.text, r.doc.lines);
  s.setText(setMetaFields(header, fields) + body + (body ? '\n' : ''));
  useApp.setState({ keyOffset: 0 });
  if (r.stats.unplayable)
    s.notify(`Re-tabbed for ${to.name} — ${r.stats.unplayable} note(s) don't fit this harmonica and are kept as note names (e.g. A#4).`);
  else if (r.warnings.length) s.notify(`Re-tabbed for ${to.name} — ${r.warnings.join('; ')}.`);
  else if (r.stats.notes) s.notify(`Re-tabbed for ${to.name} ✓`);
}

/** Moves the whole tab an octave up (+12) or down (−12) on the same harmonica, if it fits. */
export function shiftOctave(shift: 12 | -12) {
  const s = useApp.getState();
  const p = getParsed(s.text);
  const opt = octaveOptions(p.doc, p.harp).find((o) => o.shift === shift);
  if (!opt?.possible || !opt.result) {
    s.notify(opt?.note ?? 'Can’t move this tab.');
    return;
  }
  stop();
  const header = s.text.slice(0, splitHeader(s.text).bodyStart);
  const body = replaceLines(s.text, opt.result.doc.lines);
  s.setText(header + body + (body ? '\n' : ''));
  s.notify(`Moved an octave ${shift > 0 ? 'up' : 'down'} ✓`);
}

export function confirmDiscard(): boolean {
  const s = useApp.getState();
  if (!isDirty(s) || s.text.trim() === BLANK.trim()) return true;
  return window.confirm('Your current tab has unsaved changes. Discard them?');
}

export function newTab() {
  if (!confirmDiscard()) return;
  stop();
  useApp.getState().loadText(BLANK);
}

export async function saveCurrent(asCopy = false): Promise<void> {
  const s = useApp.getState();
  const text = s.text;
  try {
    const id = await saveTab(text, asCopy ? null : s.docId);
    s.markSaved(id, text);
    s.notify(asCopy ? 'Saved a copy to your library ✓' : 'Saved to your library ✓');
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
export function exportAs(kind: ExportKind, text = useApp.getState().text) {
  const p = getParsed(text);
  try {
    const { filename, data, mime } = exportDoc(kind, p.doc, p.harp, text);
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

async function importPdfFile(name: string, bytes: Uint8Array) {
  const stillOpen = () => useApp.getState().importDraft?.name === name;
  useApp.setState({ importDraft: { name, progress: { message: 'Opening PDF…', fraction: 0 } } });
  try {
    const { readPdf } = await import('../core/formats/pdf');
    const res = await readPdf(bytes, (message, fraction) => {
      const d = useApp.getState().importDraft;
      if (d?.name === name && d.progress) useApp.setState({ importDraft: { ...d, progress: { message, fraction } } });
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
    useApp.setState({ importDraft: { name, imported: { ...imp, kind }, sourceText: res.text } });
  } catch (e) {
    if (stillOpen()) useApp.setState({ importDraft: { name, error: (e as Error).message } });
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
