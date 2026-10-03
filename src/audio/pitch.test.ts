import { describe, expect, it } from 'vitest';
import { detectPitch, freqToMidi, NoteTracker } from './pitch';

const SR = 48000;

/** A reed-like tone: fundamental plus decaying harmonics, with a little noise. */
function tone(freq: number, n = 2048, seed = 1): Float32Array {
  const buf = new Float32Array(n);
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin((2 * Math.PI * freq * h * i) / SR) / (h * 0.9);
    buf[i] = v * 0.2 + rand();
  }
  return buf;
}

describe('pitch detection', () => {
  it('finds harmonica pitches across the range within a few cents', () => {
    for (const midi of [55, 60, 67, 72, 79, 84, 91, 96]) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const r = detectPitch(tone(freq), SR)!;
      expect(r).not.toBeNull();
      expect(Math.abs(freqToMidi(r.freq) - midi)).toBeLessThan(0.05);
      expect(r.clarity).toBeGreaterThan(0.8);
    }
  });

  it('follows a bend (a pitch between semitones)', () => {
    const freq = 440 * Math.pow(2, (70.5 - 69) / 12); // a half-bent note
    const r = detectPitch(tone(freq), SR)!;
    expect(freqToMidi(r.freq)).toBeCloseTo(70.5, 1);
  });

  it('rejects noise', () => {
    const noise = new Float32Array(2048);
    let s = 7;
    for (let i = 0; i < noise.length; i++) noise[i] = ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5;
    const r = detectPitch(noise, SR);
    expect(!r || r.clarity < 0.75).toBe(true);
  });
});

describe('note tracking', () => {
  it('needs a stable pitch before starting a note and ignores flicker', () => {
    const log: string[] = [];
    const t = new NoteTracker({ on: (n) => log.push(`on ${n}`), move: () => {}, off: () => log.push('off') }, 3, 3);
    [60.1, 60.0, 59.9, 64, 60.1, 60.0, null, 60, null, null, null, 62, 62, 62].forEach((m) => t.push(m));
    expect(log).toEqual(['on 60', 'off', 'on 62']);
  });
});
