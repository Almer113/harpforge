// Chord sheets: ChordPro (https://www.chordpro.org/) and plain "chords over lyrics"
// text (Ultimate Guitar style). Both become a chord-sheet document: one rest per
// chord (one bar long) carrying the chord symbol and the lyrics sung over it.

import { isChordSymbol, parseChord } from '../chords';
import { pitchClassName, prefersFlats } from '../pitch';
import { beatsPerBar, type NoteEvent, type RestEvent, type TabDoc, type TabEvent, type TabLine } from '../htab/types';
import { notesMeta, type Imported } from './common';

/** Transposes a chord symbol by semitones (keeps the quality; spells by key). */
export function transposeChord(symbol: string, semis: number, flats = false): string {
  if (!semis) return symbol;
  const info = parseChord(symbol);
  if (!info) return symbol;
  const m = /^([A-G][#b♯♭]?)(.*?)(?:\/([A-G][#b♯♭]?))?$/.exec(symbol.trim())!;
  const root = pitchClassName(info.root + semis, flats);
  const bass = info.bass !== undefined ? '/' + pitchClassName(info.bass + semis, flats) : '';
  return root + m[2] + bass;
}

const SECTION_DIRECTIVES: Record<string, string> = {
  soc: 'Chorus', start_of_chorus: 'Chorus',
  sov: 'Verse', start_of_verse: 'Verse',
  sob: 'Bridge', start_of_bridge: 'Bridge',
  start_of_intro: 'Intro', start_of_outro: 'Outro',
};

export function parseChordPro(text: string): Imported {
  const warnings: string[] = [];
  const meta = notesMeta({ tempo: 90 });
  const lines: TabLine[] = [];
  let capo = 0;
  let pendingSection: string | undefined;
  let lastEvent: RestEvent | null = null;
  let orphanLyric = '';
  let inTab = false;
  const bars = () => beatsPerBar(meta);

  const appendLyric = (txt: string) => {
    const t = txt.trim();
    if (!t) return;
    if (lastEvent) lastEvent.lyric = lastEvent.lyric ? `${lastEvent.lyric} ${t}` : t;
    else orphanLyric = orphanLyric ? `${orphanLyric} ${t}` : t;
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    const dir = /^\{\s*([A-Za-z_]+)\s*(?::\s*(.*?))?\s*\}$/.exec(trimmed);
    if (dir) {
      const name = dir[1].toLowerCase();
      const value = (dir[2] ?? '').trim();
      if (name === 'title' || name === 't') meta.title = value;
      else if (name === 'artist' || name === 'subtitle' || name === 'st' || name === 'composer') meta.artist ??= value;
      else if (name === 'key') meta.key = value;
      else if (name === 'tempo') meta.tempo = Math.max(20, Math.min(300, parseFloat(value) || meta.tempo));
      else if (name === 'time') meta.time = /^\d+\/\d+$/.test(value) ? value : meta.time;
      else if (name === 'capo') capo = parseInt(value, 10) || 0;
      else if (SECTION_DIRECTIVES[name]) pendingSection = value || SECTION_DIRECTIVES[name];
      else if (/^(start_of_|so)/.test(name) && !/tab|grid/.test(name)) pendingSection = value || name.replace(/^start_of_|^so/, '');
      else if (name === 'sot' || name === 'start_of_tab' || name === 'start_of_grid' || name === 'sog') inTab = true;
      else if (name === 'eot' || name === 'end_of_tab' || name === 'end_of_grid' || name === 'eog') inTab = false;
      else if (name === 'comment' || name === 'c' || name === 'ci' || name === 'comment_italic') pendingSection = value;
      continue;
    }
    if (inTab) continue;
    if (!trimmed) continue;

    // Split "[G]Some [C]words" into segments.
    const segRe = /\[([^\]]+)\]/g;
    const segments: { chord?: string; text: string }[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let pendingChord: string | undefined;
    while ((m = segRe.exec(line))) {
      const before = line.slice(last, m.index);
      if (pendingChord !== undefined || before) segments.push({ chord: pendingChord, text: before });
      pendingChord = m[1].trim();
      last = m.index + m[0].length;
    }
    segments.push({ chord: pendingChord, text: line.slice(last) });

    const chordSegments = segments.filter((sg) => sg.chord && parseChord(sg.chord.replace(/^\*/, '')));
    if (!chordSegments.length) {
      // A line of lyrics with no chords (or only non-chord annotations).
      appendLyric(segments.map((sg) => sg.text).join(''));
      continue;
    }
    const events: TabEvent[] = [];
    for (const sg of segments) {
      const sym = sg.chord?.replace(/^\*/, '');
      if (!sym || !parseChord(sym)) {
        appendLyric(sg.text);
        continue;
      }
      const flats = prefersFlats(meta.key) || /b/.test(sym.slice(1, 2));
      const ev: RestEvent = { kind: 'rest', beats: bars(), chord: transposeChord(sym, capo, flats) };
      const lyric = (orphanLyric ? orphanLyric + ' ' : '') + sg.text.trim();
      orphanLyric = '';
      if (lyric) ev.lyric = lyric.replace(/\s+/g, ' ');
      events.push(ev, { kind: 'bar', style: 'single' });
      lastEvent = ev;
    }
    const tl: TabLine = { events };
    if (pendingSection !== undefined) {
      tl.section = pendingSection;
      pendingSection = undefined;
    }
    lines.push(tl);
  }
  if (capo) warnings.push(`Capo ${capo}: chords were transposed up ${capo} semitone${capo > 1 ? 's' : ''} to sounding pitch.`);
  if (!lines.length) warnings.push('No chords found in this file.');
  return { doc: { meta, lines }, warnings, format: 'ChordPro' };
}

// ---- Chords over lyrics (plain text) ---------------------------------------------

const NOISE = /^(\||-+|x\d+|\d+x|N\.?C\.?|\(|\)|\/|%|\.\.\.|:\|\||\|\|:)$/i;

export function isChordLine(line: string): boolean {
  const words = line.trim().split(/\s+/).filter((w) => w && !NOISE.test(w));
  if (!words.length) return false;
  const chords = words.filter((w) => isChordSymbol(w.replace(/[(),]/g, '')));
  return chords.length / words.length >= 0.75 && chords.length >= 1 && !(words.length === 1 && /^(A|I)$/.test(words[0]) && line.length > 3);
}

const SECTION_RE = /^\s*[[(]?\s*(intro|verse|pre-?chorus|chorus|bridge|outro|interlude|solo|refrain|hook|instrumental|ending|coda|riff|break)\b[^\]):]*[\]):]?\s*/i;

/** Converts Ultimate-Guitar-style text (chord lines above lyric lines) to ChordPro. */
export function chordsOverLyricsToChordPro(text: string): string {
  const src = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out: string[] = [];
  let i = 0;

  // Title / artist / capo / key from the top of the sheet.
  for (let k = 0; k < Math.min(src.length, 12); k++) {
    const l = src[k].trim();
    let m = /^(.+?)\s+(?:chords|tabs?|ukulele chords)\s+by\s+(.+)$/i.exec(l);
    if (m) {
      out.push(`{title: ${m[1].trim()}}`, `{artist: ${m[2].trim()}}`);
      continue;
    }
    m = /^(?:title|song)\s*:\s*(.+)$/i.exec(l);
    if (m) out.push(`{title: ${m[1].trim()}}`);
    m = /^(?:artist|by)\s*:\s*(.+)$/i.exec(l);
    if (m) out.push(`{artist: ${m[1].trim()}}`);
  }
  for (const l of src) {
    const capo = /\bcapo\s*:?\s*(\d+)/i.exec(l) ?? /\bcapo\s+(?:on\s+)?(\d+)(?:st|nd|rd|th)?\s+fret/i.exec(l);
    if (capo && !isChordLine(l)) {
      out.push(`{capo: ${capo[1]}}`);
      break;
    }
  }
  for (const l of src) {
    const key = /^\s*key\s*:\s*([A-G][#b]?m?)\b/i.exec(l);
    if (key) {
      out.push(`{key: ${key[1]}}`);
      break;
    }
  }
  if (!out.some((l) => l.startsWith('{title'))) {
    const first = src.find((l) => l.trim() && !isChordLine(l) && !SECTION_RE.test(l));
    if (first && first.trim().length < 60) out.push(`{title: ${first.trim()}}`);
  }

  while (i < src.length) {
    const line = src[i];
    const trimmed = line.trim();
    if (!trimmed || /^(capo|key|tuning|tempo|bpm)\b/i.test(trimmed) || /\bchords\s+by\b/i.test(trimmed)) {
      i++;
      continue;
    }
    // Section headers: "[Chorus]", "Verse 1:", "(Bridge)". The rest of the line may hold chords.
    const sec = SECTION_RE.exec(line);
    if (sec && !isChordLine(line)) {
      out.push(`{comment: ${sec[0].replace(/[[\]():]/g, '').trim()}}`);
      const rest = line.slice(sec[0].length);
      if (rest.trim() && isChordLine(rest)) out.push(rest.trim().split(/\s+/).filter((w) => isChordSymbol(w.replace(/[(),]/g, ''))).map((c) => `[${c.replace(/[(),]/g, '')}]`).join(' '));
      i++;
      continue;
    }
    if (isChordLine(line)) {
      const next = src[i + 1];
      const chords: { col: number; sym: string }[] = [];
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        const sym = m[0].replace(/[(),]/g, '');
        if (isChordSymbol(sym)) chords.push({ col: m.index, sym });
      }
      if (next !== undefined && next.trim() && !isChordLine(next) && !SECTION_RE.test(next)) {
        // Merge the chord line into the lyric line at the chord columns.
        let lyric = next;
        const maxCol = Math.max(...chords.map((c) => c.col));
        if (lyric.length < maxCol) lyric = lyric.padEnd(maxCol, ' ');
        let merged = '';
        let pos = 0;
        for (const c of chords) {
          // A chord over the gap before a word belongs to that word.
          let col = c.col;
          if (lyric[col] === ' ' && lyric[col + 1] && lyric[col + 1] !== ' ') col++;
          // A chord over the middle of a word moves to the word's start, so lyrics stay whole.
          while (col > pos && lyric[col] && lyric[col] !== ' ' && lyric[col - 1] !== ' ') col--;
          col = Math.max(col, pos);
          merged += lyric.slice(pos, col) + `[${c.sym}]`;
          pos = col;
        }
        merged += lyric.slice(pos);
        out.push(merged.replace(/\s+$/, ''));
        i += 2;
      } else {
        out.push(chords.map((c) => `[${c.sym}]`).join(' '));
        i++;
      }
      continue;
    }
    // Plain lyric line (or guitar tab line, which we skip).
    if (!/^[eBGDAE]\|[-\d|hpbrsx/\\~()]+/.test(trimmed)) out.push(trimmed);
    i++;
  }
  return out.join('\n');
}

export function parseChordSheetText(text: string): Imported {
  const r = parseChordPro(chordsOverLyricsToChordPro(text));
  return { ...r, format: 'Chord sheet' };
}

/** Heuristic: does this text look like ChordPro (directives or inline [chords])? */
export function looksLikeChordPro(text: string): boolean {
  if (/^\s*\{\s*(title|t|artist|key|soc|start_of_\w+|comment|c)\s*[:}]/im.test(text)) return true;
  const inline = text.match(/\[[A-G][#b]?[^\]\s]{0,8}\]/g);
  return !!inline && inline.length >= 3;
}

export function looksLikeChordSheet(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const chordLines = lines.filter((l) => isChordLine(l)).length;
  return chordLines >= 2 && chordLines / Math.max(1, lines.length) >= 0.15;
}

// ---- Export ---------------------------------------------------------------------

export function writeChordPro(doc: TabDoc): string {
  const { meta } = doc;
  const out: string[] = [];
  if (meta.title) out.push(`{title: ${meta.title}}`);
  if (meta.artist) out.push(`{artist: ${meta.artist}}`);
  if (meta.key) out.push(`{key: ${meta.key}}`);
  out.push(`{tempo: ${Math.round(meta.tempo)}}`, `{time: ${meta.time}}`);
  for (const line of doc.lines) {
    if (line.section) out.push('', `{comment: ${line.section}}`);
    if (!line.events.length) continue;
    let text = '';
    let lastChord: string | undefined;
    for (const e of line.events) {
      if (e.kind === 'bar') continue;
      const ev = e as NoteEvent | RestEvent;
      if (ev.chord && ev.chord !== lastChord) {
        text += `[${ev.chord}]`;
        lastChord = ev.chord;
      }
      if (ev.lyric) {
        const syl = ev.lyric;
        text += syl.endsWith('-') ? syl.slice(0, -1) : syl + ' ';
      }
    }
    if (text.trim()) out.push(text.trimEnd());
  }
  return out.join('\n') + '\n';
}
