// A tab's history: bringing an old version back (as an edit you can undo, saved when you
// save), or keeping it as a tab of its own.

import { setMetaFields } from '../core/htab/meta';
import { saveTab, type TabVersion } from '../storage/library';
import { confirmDiscard } from './actions';
import { stop } from './playback';
import { useApp } from './store';

/** "Today, 14:32", "Yesterday, 09:05", "12 Oct, 14:32" ("12 Oct 2025, …" in another year). */
export function whenLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = (t: number) => new Date(t).toDateString();
  if (day(at) === day(now)) return `Today, ${time}`;
  if (day(at) === day(now - 86400000)) return `Yesterday, ${time}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })}, ${time}`;
}

/** The short day of a version, for a copy's title ("12 Oct"). */
function dayLabel(at: number): string {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
}

export function openHistory(tabId: string) {
  useApp.setState({ historyFor: tabId });
}

/**
 * Brings a version back into its tab, as an edit: Ctrl+Z takes it back, and saving makes it
 * the newest version. If another tab is open, the version's tab opens (at its saved text)
 * first. False if you kept the open tab.
 */
export function restoreVersion(v: TabVersion, saved: TabVersion): boolean {
  const s = useApp.getState();
  if (s.docId !== v.tabId) {
    if (!confirmDiscard()) return false;
    stop();
    s.loadText(saved.text, v.tabId, true);
  } else stop();
  useApp.getState().setText(v.text);
  const which = v.name ? `“${v.name}”` : `the version from ${whenLabel(v.at).replace(/^(Today|Yesterday)/, (w) => w.toLowerCase())}`;
  useApp.getState().notify(`Brought back ${which}. Save to keep it (Ctrl+Z takes it back).`);
  return true;
}

/** A version kept as a new tab, "Title (12 Oct)". */
export async function saveVersionAsCopy(v: TabVersion): Promise<void> {
  const title = `${v.title} (${dayLabel(v.at)})`;
  try {
    await saveTab(setMetaFields(v.text, { title }));
    useApp.getState().notify(`Saved “${title}” to your library ✓`);
  } catch (e) {
    useApp.getState().notify(`Couldn’t save the copy: ${(e as Error).message}`);
  }
}
