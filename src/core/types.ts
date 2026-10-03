// Shared musical types.

export type Breath = 'blow' | 'draw';

/** A sound described as a harmonica action: which hole, which breath, and techniques. */
export interface HoleSound {
  type: 'hole';
  hole: number;
  breath: Breath;
  /** Bend depth in semitones (0 = unbent). */
  bend: number;
  /** Overblow (on a blow) or overdraw (on a draw). */
  over: boolean;
  /** Chromatic slide button pressed. */
  slide: boolean;
}

/** A sound described as a concrete pitch, independent of any instrument. */
export interface PitchSound {
  type: 'pitch';
  midi: number;
}

export type Sound = HoleSound | PitchSound;

export function holeSound(hole: number, breath: Breath, extra: Partial<HoleSound> = {}): HoleSound {
  return { type: 'hole', hole, breath, bend: 0, over: false, slide: false, ...extra };
}

export function sameHoleSound(a: HoleSound, b: HoleSound): boolean {
  return a.hole === b.hole && a.breath === b.breath && a.bend === b.bend && a.over === b.over && a.slide === b.slide;
}
