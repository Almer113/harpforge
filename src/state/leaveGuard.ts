// Closing the page (or reloading it, or going to another site) when work would be lost asks
// first — the browser's own "Leave site?": the open song has unsaved changes (not an empty
// new song), a recording is under way, typed text hasn't gone into the song yet (a field
// still being typed in, the lyric box, "Fill lyrics", the import paste box), a save to the
// library is still on its way, or practice history or syllable fixes haven't reached the
// account yet. Moving between the app's pages doesn't ask (the song
// stays open), nor does opening another song (that asks in the app).
//
// The question is only set up while it's needed: a page without it closes at once, and the
// browser can keep it for Back and Forward. (iPhone and iPad Safari never ask; the working
// copy is still kept in the browser when the page closes.)

import { useEffect, useId } from 'react';
import { isBlankSong } from '../demo/songs';
import { unsentChanges, watchUnsent } from '../storage/userData';
import { isDirty, useApp, type AppState } from './store';

/** Typed text not in the song yet, by who holds it (see useDraft). */
const drafts = new Set<string>();

/** What would be lost by leaving now (null: nothing). */
export function wouldLose(
  s: Pick<AppState, 'text' | 'savedText' | 'savesPending' | 'recording' | 'fillLyricsOpen' | 'fillDraft'>,
  unsent = unsentChanges(),
): 'changes' | 'recording' | 'draft' | 'saving' | 'practice' | null {
  if (isDirty(s) && !isBlankSong(s.text)) return 'changes';
  // (A recording's notes go into the song only when it stops.)
  if (s.recording) return 'recording';
  if (drafts.size || (s.fillLyricsOpen && s.fillDraft.trim())) return 'draft';
  if (s.savesPending > 0) return 'saving';
  if (unsent > 0) return 'practice';
  return null;
}

/**
 * Typed text that isn't in the song yet (`pending`): leaving the page asks while it is. A
 * field that commits when you leave it or press Enter says so with this.
 */
export function useDraft(pending: boolean) {
  const id = useId();
  useEffect(() => {
    if (!pending) return;
    drafts.add(id);
    update();
    return () => {
      drafts.delete(id);
      update();
    };
  }, [id, pending]);
}

const ask = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  // (Older browsers want this set too; none show the text any more.)
  e.returnValue = '';
};

let asking = false;
function update() {
  const need = wouldLose(useApp.getState()) !== null;
  if (need === asking || typeof window === 'undefined') return;
  asking = need;
  if (need) window.addEventListener('beforeunload', ask);
  else window.removeEventListener('beforeunload', ask);
}

const off = useApp.subscribe((s, prev) => {
  if (
    s.text !== prev.text ||
    s.savedText !== prev.savedText ||
    s.savesPending !== prev.savesPending ||
    s.recording !== prev.recording ||
    s.fillLyricsOpen !== prev.fillLyricsOpen ||
    s.fillDraft !== prev.fillDraft
  )
    update();
});
const offUnsent = watchUnsent(update);
update();

// (Development: this module loaded again doesn't leave the old one listening.)
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    off();
    offUnsent();
    window.removeEventListener('beforeunload', ask);
  });
