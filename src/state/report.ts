// The practice report on screen, and "Drill": loop a bar slowly with the tempo trainer.

import type { Passage } from '../core/passage';
import type { SessionReport } from '../core/report';
import { logSession, songLog } from '../storage/practiceLog';
import { startTrainer } from './playback';
import { getParsed, useApp } from './store';

/**
 * Shows a session's report with the song's earlier sessions. `log`: the session is over, so
 * it joins the song's history (songs in the library only).
 */
export function showReport(session: SessionReport, log: boolean) {
  const s = useApp.getState();
  const history = s.docId ? songLog(s.docId) : [];
  const at = Date.now();
  if (log && s.docId && session.notes > 0) logSession(s.docId, session, at);
  useApp.setState({ report: { session, history, title: getParsed(s.text).doc.meta.title || 'Untitled', at } });
}

export function closeReport() {
  useApp.setState({ report: null });
}

/** Works on a bar: loops it slowly with the tempo trainer, playing along to check it. */
export function drill(passage: Passage) {
  const first = getParsed(useApp.getState().text).score.events.find((ev) => ev.start >= passage.start - 1e-6);
  useApp.setState({ report: null, passage, selectedEvent: first?.index ?? null, loop: false, loopRange: null, along: true, practice: null, alongPasses: [], alongMarks: {} });
  startTrainer();
}
