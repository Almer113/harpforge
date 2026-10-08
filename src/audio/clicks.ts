// Which metronome and count-in clicks are accented (higher and louder): the first beat of
// each bar of the music, and of each bar of the count before it.

export interface ClickInfo {
  /** Where score beat 0 sits on the transport (the count-in fits before it). */
  offset: number;
  /** Where the score's bars start (score beats); without them, every `bpb` beats from 0. */
  barStarts?: number[];
  /** Where the count before the music starts (score beats), and how many beats it lasts. */
  countFrom: number;
  count: number;
}

const EPS = 1e-6;

/** Whether the click on score beat `beat` is accented. */
export function isAccent(beat: number, info: ClickInfo, bpb: number): boolean {
  const { barStarts, countFrom, count } = info;
  const near = (x: number) => Math.abs(x) < EPS || Math.abs(x - bpb) < EPS;
  if (count > 0 && beat >= countFrom - EPS && beat < countFrom + count - EPS) return near((beat - countFrom) % bpb);
  if (barStarts?.length) return barStarts.some((b) => Math.abs(b - beat) < EPS);
  return near(((beat % bpb) + bpb) % bpb);
}
