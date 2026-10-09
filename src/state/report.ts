// The practice report on screen, and "Drill": loop a bar slowly with the tempo trainer.

import type { Passage } from '../core/passage';
import type { SessionReport } from '../core/report';
import { logSession, songLog } from '../storage/practiceLog';
import { startTrainer, stop } from './playback';
import { alongReport } from '../core/report';
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

/** A play-along session that's being left (for a drill, or practice mode) joins the song's history. */
export function keepAlongSession() {
  const s = useApp.getState();
  if (s.along && s.alongPasses.length && s.docId) logSession(s.docId, alongReport(getParsed(s.text).score, s.alongPasses));
}

export function closeReport() {
  useApp.setState({ report: null });
}

/**
 * Works on a bar: loops it slowly with the tempo trainer, counting in, playing along to
 * check it. A play-along session still going is kept in the song's history first.
 */
export function drill(passage: Passage) {
  stop();
  keepAlongSession();
  const s = useApp.getState();
  const first = getParsed(s.text).score.events.find((ev) => ev.start >= passage.start - 1e-6);
  useApp.setState({ report: null, passage, selectedEvent: first?.index ?? null, loop: false, loopRange: null, along: true, practice: null, alongPasses: [], alongMarks: {}, alongPrev: {} });
  startTrainer({ count: true });
}
