// Guitar Pro 3, 4 and 5 files (.gp3, .gp4, .gp5: binary). Every byte of the file is walked
// (most of it is how the song is played back and drawn), keeping, for each track and voice: its
// notes as pitches (string and fret on the track's tuning, and capo), their lengths (dots,
// tuplets), ties, chord names; and for the song: the title and artist, the tempo (and its
// changes), time and key, repeats, 1st/2nd endings, markers as sections, and the words (Guitar
// Pro 4–5 keep them as text, for one track, laid on its notes from a bar on).

import type { Imported } from './common';
import { pickPart, songToDoc, type GpBar, type GpBeat, type GpOption, type GpSong } from './gpsong';

const BROKEN = 'This Guitar Pro file could not be read (it may be damaged, or not a Guitar Pro 3–5 file).';

/** Whether the bytes are a Guitar Pro 1–5 file (by its opening words). */
export function isGp345(bytes: Uint8Array): boolean {
  const n = bytes[0];
  if (!n || n > 30 || bytes.length < 31) return false;
  return /^FICHIER GUITARE? PRO/.test(String.fromCharCode(...bytes.subarray(1, 1 + n)));
}

class Bytes {
  pos = 0;
  private dv: DataView;
  private text = new TextDecoder('windows-1252');
  constructor(private b: Uint8Array) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  private need(n: number) {
    if (n < 0 || this.pos + n > this.b.length) throw new Error(BROKEN);
  }
  skip(n: number) {
    this.need(n);
    this.pos += n;
  }
  u8() {
    this.need(1);
    return this.b[this.pos++];
  }
  i8() {
    const v = this.u8();
    return v > 127 ? v - 256 : v;
  }
  i16() {
    this.need(2);
    const v = this.dv.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i32() {
    this.need(4);
    const v = this.dv.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** `count` bytes, of which the first `length` are the text. */
  private chars(count: number, length: number) {
    this.need(count);
    const s = this.text.decode(this.b.subarray(this.pos, this.pos + Math.min(length, count)));
    this.pos += count;
    return s;
  }
  /** A length byte, then a field of `size` bytes (or just the text, when no size). */
  byteText(size = 0) {
    const length = this.u8();
    return this.chars(size > 0 ? size : length, length);
  }
  /** A 4-byte field size, then a length byte and the field. */
  intByteText() {
    return this.byteText(this.i32() - 1);
  }
  /** A 4-byte length, then the text. */
  intText() {
    const n = this.i32();
    return this.chars(n, n);
  }
  /** A count, kept to what a song could have. */
  count(max: number) {
    const n = this.i32();
    if (n < 0 || n > max) throw new Error(BROKEN);
    return n;
  }
}

interface Header {
  time: string;
  repeatStart: boolean;
  repeatEnd?: number;
  /** As bits: 1st ending 1, 2nd 2, 3rd 4… */
  endings: number;
  section?: string;
  key?: { accidentals: number; minor: boolean };
}

interface Track {
  name: string;
  tuning: number[];
  capo: number;
  drums: boolean;
  lastFret: number[][];
  /** Bar → voice → beats. */
  bars: GpBeat[][][];
}

/** n notes in the time of… */
const TUPLETS: Record<number, number> = { 3: 2, 5: 4, 6: 4, 7: 4, 9: 8, 10: 8, 11: 8, 12: 8, 13: 8 };

/** A Guitar Pro 3–5 file: the track and voice asked for (`part`: "0:0"), or else the most melody-like. */
export function parseGp345(bytes: Uint8Array, opts: { part?: string } = {}): Imported {
  const r = new Bytes(bytes);
  const head = r.byteText(30);
  const m = /PRO [vL](\d)\.(\d\d)/.exec(head);
  const ver = m ? Number(m[1]) * 100 + Number(m[2]) : 0;
  if (!head.startsWith('FICHIER GUITAR PRO') || ver < 300 || ver >= 600) throw new Error(/GUITARE/.test(head) ? 'Guitar Pro 1–2 files aren’t read: save the song from a newer Guitar Pro, or export it as MusicXML.' : BROKEN);

  // The song.
  const title = r.intByteText();
  r.intByteText(); // subtitle
  const artist = r.intByteText();
  r.intByteText(); // album
  r.intByteText(); // words by
  if (ver >= 500) r.intByteText(); // music by
  r.intByteText(); // copyright
  r.intByteText(); // tabbed by
  r.intByteText(); // instructions
  for (let n = r.count(1000); n > 0; n--) r.intByteText(); // notice
  if (ver < 500) r.skip(1); // triplet feel
  let lyricTrack = -1;
  const lyrics: { from: number; text: string }[] = [];
  if (ver >= 400) {
    lyricTrack = r.i32() - 1;
    for (let k = 0; k < 5; k++) lyrics.push({ from: r.i32() - 1, text: r.intText() });
  }
  if (ver >= 510) r.skip(19); // the master volume and equaliser
  if (ver >= 500) {
    r.skip(30); // page size, margins, score size, header flags
    for (let k = 0; k < 10; k++) r.intByteText(); // page header and footer templates
    r.intByteText(); // tempo name
  }
  const tempo = r.i32();
  if (ver >= 510) r.skip(1); // tempo hidden
  // (The key: one byte, then three or four more.)
  const songKey = r.i8();
  r.skip(ver >= 400 ? 4 : 3);
  r.skip(64 * 12); // the MIDI channels
  if (ver >= 500) r.skip(42); // directions (coda, segno…), and reverb
  const barCount = r.count(5000);
  const trackCount = r.count(100);

  // The bars.
  const headers: Header[] = [];
  let time = '4/4';
  let [num, den] = [4, 4];
  for (let b = 0; b < barCount; b++) {
    const flags = r.u8();
    if (flags & 0x01) num = r.i8();
    if (flags & 0x02) den = r.i8();
    time = `${num}/${den}`;
    const h: Header = { time, repeatStart: !!(flags & 0x04), endings: 0 };
    if (flags & 0x08) h.repeatEnd = r.u8() + (ver >= 500 ? 0 : 1);
    if (flags & 0x10 && ver < 500) {
      // (Guitar Pro 3–4 keep the ending's number: it takes that one and those before it not yet taken since the repeat began.)
      const n = r.u8();
      let taken = 0;
      for (let k = headers.length - 1; k >= 0 && !headers[k].repeatStart; k--) taken |= headers[k].endings;
      for (let k = 0; k < n && k < 30; k++) if (!(taken & (1 << k))) h.endings |= 1 << k;
    }
    if (flags & 0x20) {
      h.section = r.intByteText();
      r.skip(4); // its colour
    }
    if (flags & 0x40) h.key = { accidentals: r.i8(), minor: r.u8() === 1 };
    if (ver >= 500) {
      if (flags & 0x03) r.skip(4); // beaming
      const endings = r.u8();
      if (flags & 0x10) h.endings = endings;
      r.skip(2); // triplet feel, and a byte
    }
    headers.push(h);
  }

  // The tracks.
  const tracks: Track[] = [];
  for (let t = 0; t < trackCount; t++) {
    const flags = r.u8();
    const name = r.byteText(40);
    const strings = r.count(7);
    const tuning: number[] = [];
    for (let k = 0; k < 7; k++) {
      const p = r.i32();
      if (k < strings) tuning.push(p);
    }
    r.skip(4); // port
    const channel = r.i32();
    r.skip(8); // effect channel, frets
    const capo = r.i32();
    r.skip(4); // colour
    if (ver >= 500) {
      r.skip(45); // how it's shown and played back
      if (ver >= 510) {
        r.skip(4);
        r.intByteText();
        r.intByteText();
      }
    }
    tracks.push({ name: name.trim(), tuning, capo: Math.max(0, capo), drums: !!(flags & 0x01) || channel === 10, lastFret: [], bars: [] });
  }

  // The notes: bar by bar, each track's.
  const tempos = [{ bar: 0, bpm: tempo }];
  const bend = () => {
    r.skip(5);
    r.skip(9 * r.count(100));
  };
  const chordName = (): string => {
    if (ver >= 500) {
      r.skip(17);
      const name = r.byteText(21);
      r.skip(4 + 4 + 28 + 1 + 5 + 26);
      return name;
    }
    if (r.u8()) {
      if (ver >= 400) {
        r.skip(16);
        const name = r.byteText(21);
        r.skip(4 + 4 + 28 + 1 + 5 + 26);
        return name;
      }
      r.skip(25);
      const name = r.byteText(34);
      r.skip(4 + 24 + 36);
      return name;
    }
    const name = r.intByteText();
    if (r.i32() > 0) r.skip(4 * (ver >= 406 ? 7 : 6));
    return name;
  };
  for (let b = 0; b < barCount; b++) {
    for (const track of tracks) {
      if (ver >= 500) r.skip(1);
      const voices: GpBeat[][] = [];
      for (let v = 0; v < (ver >= 500 ? 2 : 1); v++) {
        const beats: GpBeat[] = [];
        // (The fret last played on each string, in this voice: a tied note sounds on it.)
        const lastFret = (track.lastFret[v] ??= []);
        for (let n = r.count(1000); n > 0; n--) {
          const flags = r.u8();
          if (flags & 0x40) r.skip(1); // empty, or a rest
          const dur = r.i8();
          let len = dur >= -2 && dur <= 6 ? Math.pow(2, -dur) : 1;
          if (flags & 0x01) len *= 1.5;
          if (flags & 0x20) {
            const tn = r.i32();
            if (TUPLETS[tn]) len *= TUPLETS[tn] / tn;
          }
          const beat: GpBeat = { beats: len, midis: [] };
          if (flags & 0x02) beat.chord = chordName();
          if (flags & 0x04) r.intByteText(); // text
          if (flags & 0x08) {
            const f1 = r.u8();
            const f2 = ver >= 400 ? r.u8() : 0;
            if (f1 & 0x20) r.skip(ver >= 400 ? 1 : 5); // tap, slap, pop (or Guitar Pro 3's whammy bar)
            if (f2 & 0x04) bend(); // whammy bar
            if (f1 & 0x40) r.skip(2); // strum
            if (f2 & 0x02) r.skip(1); // pick stroke
          }
          if (flags & 0x10) {
            // A change of instrument, volume… or tempo.
            r.skip(1);
            if (ver >= 500) r.skip(16);
            const values = [r.i8(), r.i8(), r.i8(), r.i8(), r.i8(), r.i8()];
            if (ver >= 500) r.intByteText();
            const bpm = r.i32();
            r.skip(values.filter((x) => x >= 0).length);
            if (bpm >= 0) r.skip(ver >= 510 ? 2 : 1);
            if (ver >= 400) r.skip(1);
            if (ver >= 500) r.skip(1);
            if (ver >= 510) {
              r.intByteText();
              r.intByteText();
            }
            if (bpm > 0) tempos.push({ bar: b, bpm });
          }
          const strings = r.u8();
          let tied = false;
          for (let i = 6; i >= 0; i--) {
            if (!(strings & (1 << i)) || 6 - i >= track.tuning.length) continue;
            const s = 6 - i;
            const nf = r.u8();
            const type = nf & 0x20 ? r.u8() : 1;
            if (nf & 0x01 && ver < 500) r.skip(2);
            if (nf & 0x10) r.skip(1); // loudness
            let fret = nf & 0x20 ? r.i8() : 0;
            if (nf & 0x80) r.skip(2); // fingering
            if (ver >= 500) r.skip(nf & 0x01 ? 9 : 1);
            if (nf & 0x08) {
              const e1 = r.u8();
              const e2 = ver >= 400 ? r.u8() : 0;
              if (e1 & 0x01) bend();
              if (e1 & 0x10) r.skip(ver >= 500 ? 5 : 4); // a grace note
              if (e2 & 0x04) r.skip(1); // tremolo picking
              if (e2 & 0x08) r.skip(1); // slide
              if (e2 & 0x10) {
                const harmonic = r.u8();
                if (ver >= 500) r.skip(harmonic === 2 ? 3 : harmonic === 3 ? 1 : 0);
              }
              if (e2 & 0x20) r.skip(2); // trill
            }
            if (type === 3) continue; // a dead note: no pitch
            if (type === 2) {
              tied = true;
              fret = lastFret[s] ?? fret;
            }
            lastFret[s] = fret;
            beat.midis.push(track.tuning[s] + fret + track.capo);
          }
          if (tied) beat.tied = true;
          if (ver >= 500 && r.i16() & 0x0800) r.skip(1);
          beats.push(beat);
        }
        voices.push(beats);
      }
      track.bars.push(voices);
    }
  }

  // Each track (not the drums), and each of its voices with notes in it.
  const options: GpOption[] = [];
  tracks.forEach((track, t) => {
    if (track.drums) return;
    const used = [0, 1].filter((v) => track.bars.some((bar) => bar[v]?.some((x) => x.midis.length)));
    const label = track.name || `Track ${t + 1}`;
    for (const v of used) {
      const song = (): GpSong => ({
        title,
        artist,
        key: headers[0]?.key ?? { accidentals: songKey, minor: false },
        tempos,
        lyrics: t === lyricTrack ? lyrics.map((l) => ({ from: Math.max(0, l.from), text: l.text })) : [],
        bars: headers.map(
          (h, b): GpBar => ({
            time: h.time,
            repeatStart: h.repeatStart,
            repeatEnd: h.repeatEnd,
            endings: [...Array(8).keys()].filter((k) => h.endings & (1 << k)).map((k) => k + 1),
            section: h.section?.trim() || undefined,
            beats: track.bars[b][v] ?? [],
          }),
        ),
      });
      options.push({ id: `${t}:${v}`, label: label + (used.length > 1 ? ` · voice ${v + 1}` : ''), name: track.name, read: () => songToDoc(song(), 'Guitar Pro') });
    }
  });
  return pickPart(options, opts.part, (id) => parseGp345(bytes, { part: id }));
}
