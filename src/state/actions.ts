// User-level actions shared by several pages.

import { retab } from '../core/convert';
import { setMetaFields } from '../core/htab/meta';
import { splitHeader } from '../core/htab/parser';
import { bodyText } from '../core/htab/serializer';
import { getHarmonica, specId, type HarmonicaSpec } from '../core/instruments';
import { BLANK } from '../demo/songs';
import { isChordSheet } from '../core/convert';
import { decodeText, exportDoc, importBytes, IMPORT_ACCEPT, type ExportKind, type Imported } from '../core/formats';
import { saveTab } from '../storage/library';
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
  const body = bodyText(r.doc.lines);
  s.setText(setMetaFields(header, fields) + body + (body ? '\n' : ''));
  useApp.setState({ keyOffset: 0 });
  if (r.warnings.length) s.notify(`Re-tabbed for ${to.name} — ${r.warnings.length} note(s) couldn't be placed.`);
  else if (r.stats.notes) s.notify(`Re-tabbed for ${to.name} ✓`);
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
  const id = await saveTab(s.text, asCopy ? null : s.docId);
  s.markSaved(id);
  s.notify(asCopy ? 'Saved a copy to your library ✓' : 'Saved to your library ✓');
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

/** Opens a file picker; tabs load directly, everything else goes through the import dialog. */
export function importFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = IMPORT_ACCEPT;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
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
  };
  input.click();
}

/** Opens the import dialog in paste mode. */
export function openPasteImport() {
  useApp.setState({ importDraft: { name: 'Pasted text', pasteText: '' } });
}

export function loadTabText(text: string, name: string) {
  if (!confirmDiscard()) return;
  stop();
  const s = useApp.getState();
  s.loadText(text);
  const { issues } = getParsed(text);
  const errors = issues.filter((i) => i.severity === 'error').length;
  s.notify(errors ? `Imported "${name}" with ${errors} problem(s) — see the editor.` : `Imported "${name}" ✓`);
}
