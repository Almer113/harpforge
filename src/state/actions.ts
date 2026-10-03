// User-level actions shared by several pages.

import { retab } from '../core/convert';
import { setMetaFields } from '../core/htab/meta';
import { splitHeader } from '../core/htab/parser';
import { bodyText } from '../core/htab/serializer';
import { getHarmonica, specId, type HarmonicaSpec } from '../core/instruments';
import { BLANK } from '../demo/songs';
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

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tab';
}

export function downloadText(filename: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCurrent(text = useApp.getState().text) {
  const title = getParsed(text).doc.meta.title ?? 'tab';
  downloadText(`${slug(title)}.htab`, text);
}

/** Opens a file picker and loads the chosen .htab / .txt file. */
export function importFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.htab,.txt,text/plain';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = (await file.text()).replace(/\r\n?/g, '\n');
    if (!confirmDiscard()) return;
    stop();
    const s = useApp.getState();
    s.loadText(text);
    const { issues } = getParsed(text);
    const errors = issues.filter((i) => i.severity === 'error').length;
    s.notify(errors ? `Imported "${file.name}" with ${errors} problem(s) — see the editor.` : `Imported "${file.name}" ✓`);
  };
  input.click();
}
