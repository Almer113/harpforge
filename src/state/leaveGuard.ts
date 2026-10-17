// Closing the page (or reloading it, or going to another site) when work would be lost asks
// first — the browser's own "Leave site?": the open song has unsaved changes (not an empty
// new song), a save to the library is still on its way, or practice history or syllable
// fixes haven't reached the account yet. Moving between the app's pages doesn't ask (the song
// stays open), nor does opening another song (that asks in the app).
//
// The question is only set up while it's needed: a page without it closes at once, and the
// browser can keep it for Back and Forward. (iPhone and iPad Safari never ask; the working
// copy is still kept in the browser when the page closes.)

import { BLANK } from '../demo/songs';
import { unsentChanges, watchUnsent } from '../storage/userData';
import { isDirty, useApp, type AppState } from './store';

/** What would be lost by leaving now (null: nothing). */
export function wouldLose(s: Pick<AppState, 'text' | 'savedText' | 'savesPending'>, unsent = unsentChanges()): 'changes' | 'saving' | 'practice' | null {
  if (isDirty(s) && s.text.trim() !== BLANK.trim()) return 'changes';
  if (s.savesPending > 0) return 'saving';
  if (unsent > 0) return 'practice';
  return null;
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

useApp.subscribe((s, prev) => {
  if (s.text !== prev.text || s.savedText !== prev.savedText || s.savesPending !== prev.savesPending) update();
});
watchUnsent(update);
update();
