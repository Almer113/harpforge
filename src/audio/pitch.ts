// Monophonic pitch detection (YIN, de Cheveigné & Kawahara 2002), tuned for the
// harmonica's range. Pure function: feed it a block of samples.

export interface PitchResult {
  /** Frequency in Hz. */
  freq: number;
  /** 0..1, how periodic the signal is (higher = cleaner pitch). */
  clarity: number;
}

export interface YinOptions {
  minFreq?: number;
  maxFreq?: number;
  threshold?: number;
}

export function detectPitch(buf: Float32Array, sampleRate: number, opts: YinOptions = {}): PitchResult | null {
  const minFreq = opts.minFreq ?? 70;
  const maxFreq = opts.maxFreq ?? 2600;
  const threshold = opts.threshold ?? 0.15;
  const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(buf.length / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const W = buf.length - maxTau;
  if (W <= 0) return null;

  // Difference function + cumulative mean normalised difference.
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // First dip under the threshold (then its local minimum); else the global minimum.
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= maxTau && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    let best = minTau;
    for (let t = minTau; t <= maxTau; t++) if (cmnd[t] < cmnd[best]) best = t;
    if (cmnd[best] > 0.35) return null;
    tau = best;
  }

  // Parabolic interpolation for sub-sample accuracy.
  let refined = tau;
  if (tau > 1 && tau < maxTau) {
    const a = cmnd[tau - 1];
    const b = cmnd[tau];
    const c = cmnd[tau + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) refined = tau + (a - c) / (2 * denom);
  }
  return { freq: sampleRate / refined, clarity: Math.max(0, Math.min(1, 1 - cmnd[tau])) };
}

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

export function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

/**
 * Turns a stream of per-frame pitches into note on / change / off events, so a
 * held note doesn't flicker. A new note must be stable for `stableFrames` frames.
 */
export class NoteTracker {
  private current: number | null = null;
  private candidate: number | null = null;
  private count = 0;
  private silent = 0;

  constructor(
    private handlers: { on(note: number, midi: number): void; move(midi: number): void; off(): void },
    private stableFrames = 3,
    private releaseFrames = 4,
  ) {}

  /** Feed one frame: a fractional MIDI pitch, or null for silence / no clear pitch. */
  push(midi: number | null) {
    if (midi === null) {
      this.candidate = null;
      this.count = 0;
      if (this.current !== null && ++this.silent >= this.releaseFrames) {
        this.current = null;
        this.handlers.off();
      }
      return;
    }
    this.silent = 0;
    const note = Math.round(midi);
    if (this.current !== null && note === this.current) {
      this.candidate = null;
      this.count = 0;
      this.handlers.move(midi);
      return;
    }
    if (note === this.candidate) this.count++;
    else {
      this.candidate = note;
      this.count = 1;
    }
    if (this.count >= this.stableFrames) {
      if (this.current !== null) this.handlers.off();
      this.current = note;
      this.candidate = null;
      this.count = 0;
      this.handlers.on(note, midi);
    }
  }

  reset() {
    if (this.current !== null) this.handlers.off();
    this.current = null;
    this.candidate = null;
    this.count = 0;
    this.silent = 0;
  }
}
