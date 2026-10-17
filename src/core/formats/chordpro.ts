// Chord sheets: ChordPro (https://www.chordpro.org/) and plain "chords over lyrics"
// text (Ultimate Guitar style). Both become a chord-sheet document: one rest per
// chord (one bar long) carrying the chord symbol and the lyrics sung over it.

import { isChordSymbol, isNoChord, parseChord, transposeChord } from '../chords';
import { keyUsesFlats } from '../pitch';
import { beatsPerBar, type NoteEvent, type RestEvent, type TabDoc, type TabEvent, type TabLine } from '../htab/types';
import { notesMeta, type Imported } from './common';
import { isHeld, lineVerse, lineVerses, lyricOf } from '../verses';

export { transposeChord };

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
  let seenChord = false;
  let orphanLyric = ''; // lyrics before the very first chord: sung over it
  // Lyric lines before any chord, as written (a file with no chords at all keeps them).
  const lyricLines: { text: string; section?: string }[] = [];
  let inTab = false;
  // The chorus ({soc} … {eoc}): its lines, for {chorus} to bring back.
  let chorusFrom: number | null = null;
  let chorus: TabLine[] = [];
  // (And, before the song's first chord, its lyric lines.)
  let lyricChorusFrom: number | null = null;
  let lyricChorus: { text: string; section?: string }[] = [];
  const endChorus = () => {
    if (chorusFrom !== null) chorus = lines.slice(chorusFrom).map((l) => ({ ...l, events: l.events.map((e) => ({ ...e })) }));
    if (lyricChorusFrom !== null) lyricChorus = lyricLines.slice(lyricChorusFrom);
    chorusFrom = null;
    lyricChorusFrom = null;
  };
  const bars = () => beatsPerBar(meta);

  /**
   * Beats for each part of a line, from how much is sung over it: a typical lyric
   * line is about two bars; chord-only lines get a bar per chord.
   */
  const allocate = (segs: { chars: number; isChord: boolean }[]): number[] => {
    const bpb = bars();
    if (segs.every((sg) => sg.chars === 0)) return segs.map(() => bpb);
    const total = segs.reduce((a, sg) => a + Math.max(1, sg.chars), 0);
    const chordCount = segs.filter((sg) => sg.isChord).length;
    const mins = segs.map((sg) => (sg.isChord ? Math.min(2, Math.floor(bpb)) || 1 : 1));
    const nBars = Math.max(Math.min(4, Math.max(1, Math.round(total / 22))), Math.ceil(chordCount / 2), Math.ceil(mins.reduce((a, b) => a + b, 0) / bpb - 1e-6));
    // Whole beats are shared out; a bar ending on a half beat (7/8) gives its fraction to the last part.
    const totalBeats = Math.floor(nBars * bpb + 1e-6);
    const frac = nBars * bpb - totalBeats;
    const beats = segs.map((sg, k) => Math.max(mins[k], Math.round((totalBeats * Math.max(1, sg.chars)) / total)));
    let diff = totalBeats - beats.reduce((a, b) => a + b, 0);
    while (diff !== 0) {
      const byLength = beats.map((_, k) => k).sort((a, b) => beats[b] - beats[a]);
      const k = diff > 0 ? byLength[0] : byLength.find((j) => beats[j] > mins[j]);
      if (k === undefined) break;
      beats[k] += diff > 0 ? 1 : -1;
      diff += diff > 0 ? -1 : 1;
    }
    if (frac > 1e-6) beats[beats.length - 1] += frac;
    return beats;
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || /^(```|~~~)/.test(trimmed)) continue;
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
      else if (name === 'sot' || name === 'start_of_tab' || name === 'start_of_grid' || name === 'sog') inTab = true;
      else if (name === 'eot' || name === 'end_of_tab' || name === 'end_of_grid' || name === 'eog') inTab = false;
      else if (name === 'soc' || name === 'start_of_chorus') {
        endChorus();
        chorusFrom = lines.length;
        if (!seenChord) lyricChorusFrom = lyricLines.length;
        pendingSection = value || 'Chorus';
      } else if (name === 'eoc' || name === 'end_of_chorus') endChorus();
      else if (name === 'chorus') {
        // {chorus}: the last chorus again, here.
        endChorus();
        if (!seenChord && lyricChorus.length && !chorus.length) {
          lyricChorus.forEach((l, k) => {
            lyricLines.push({ text: l.text, section: k === 0 ? value || l.section || 'Chorus' : undefined });
            orphanLyric = `${orphanLyric} ${l.text}`.trim();
          });
        } else if (!chorus.length) warnings.push('“{chorus}” with no chorus ({soc} … {eoc}) before it: left out.');
        else
          chorus.forEach((l, k) => {
            const copy: TabLine = { ...l, events: l.events.map((e) => ({ ...e })) };
            delete copy.src;
            if (k === 0) copy.section = value || l.section || 'Chorus';
            else delete copy.section;
            lines.push(copy);
          });
      } else if (SECTION_DIRECTIVES[name]) {
        endChorus();
        pendingSection = value || SECTION_DIRECTIVES[name];
      }
      else if (/^(start_of_|so)/.test(name)) pendingSection = value || name.replace(/^start_of_|^so/, '');
      else if (name === 'comment' || name === 'c' || name === 'ci' || name === 'comment_italic') pendingSection = value;
      continue;
    }
    if (inTab || !trimmed) continue;

    // Split "Words [G]some [C]words" into a lead-in and chord parts.
    const parts: { sym?: string; text: string }[] = [{ text: '' }];
    const segRe = /\[([^\]]+)\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = segRe.exec(line))) {
      parts[parts.length - 1].text += line.slice(last, m.index);
      const sym = m[1].trim().replace(/^\*/, '');
      if (isNoChord(sym)) parts.push({ sym: 'N.C.', text: '' });
      else if (parseChord(sym)) parts.push({ sym, text: '' });
      last = m.index + m[0].length;
    }
    parts[parts.length - 1].text += line.slice(last);
    const lead = parts[0].text.trim().replace(/\s+/g, ' ');
    const chordParts = parts.slice(1);

    if (!seenChord) {
      // Lyrics before the first chord of the song are sung over that first chord.
      if (lead) {
        orphanLyric = orphanLyric ? `${orphanLyric} ${lead}` : lead;
        lyricLines.push({ text: lead, section: pendingSection });
        pendingSection = undefined;
      }
      if (!chordParts.length) continue;
      // ("Well-[G]known": no space either side of the chord, so the word carries on.)
      const glue = lead && !/\s$/.test(parts[0].text) && !/^\s/.test(chordParts[0].text) ? '' : ' ';
      chordParts[0].text = orphanLyric + (orphanLyric ? glue : '') + chordParts[0].text.trimStart();
      orphanLyric = '';
    }
    // A lead-in (or a whole line without chords) continues the previous chord.
    const segs: { sym?: string; text: string; raw: string }[] = [];
    if (seenChord && lead) segs.push({ text: lead, raw: parts[0].text });
    for (const cp of chordParts) segs.push({ sym: cp.sym, text: cp.text.trim().replace(/\s+/g, ' '), raw: cp.text });
    if (!segs.length) continue;
    // A chord inside a word ("a[F]bove") splits it into syllables: "a-" "bove".
    for (let k = 0; k + 1 < segs.length; k++) {
      if (segs[k].text && segs[k + 1].text && !/\s$/.test(segs[k].raw) && !/^\s/.test(segs[k + 1].raw)) segs[k].text += '-';
    }
    seenChord = true;

    const beats = allocate(segs.map((sg) => ({ chars: sg.text.length, isChord: !!sg.sym })));
    const chordOnly = segs.every((sg) => !sg.text);
    const events: TabEvent[] = [];
    segs.forEach((sg, k) => {
      const ev: RestEvent = { kind: 'rest', beats: beats[k] };
      if (sg.sym) {
        const flats = keyUsesFlats(meta.key) || /b/.test(sg.sym.slice(1, 2));
        ev.chord = isNoChord(sg.sym) ? 'N.C.' : transposeChord(sg.sym, capo, flats);
      }
      if (sg.text) ev.lyric = sg.text;
      events.push(ev);
      if (chordOnly) events.push({ kind: 'bar', style: 'single' });
    });
    if (!chordOnly) events.push({ kind: 'bar', style: 'single' });
    const tl: TabLine = { events };
    if (pendingSection !== undefined) {
      tl.section = pendingSection;
      pendingSection = undefined;
    }
    lines.push(tl);
  }
  if (capo) warnings.push(`Capo ${capo}: chords were transposed up ${capo} semitone${capo > 1 ? 's' : ''} to sounding pitch.`);
  if (!seenChord && lyricLines.length) {
    // No chords at all: the lyrics come in line by line, as words over rests.
    for (const l of lyricLines) {
      const [beats] = allocate([{ chars: l.text.length, isChord: false }]);
      const tl: TabLine = { events: [{ kind: 'rest', beats, lyric: l.text }, { kind: 'bar', style: 'single' }] };
      if (l.section !== undefined) tl.section = l.section;
      lines.push(tl);
    }
    warnings.push('No chords in this file: the lyrics came in as words over rests.');
  } else if (!lines.length) warnings.push('No chords found in this file.');
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

const SECTION_RE = /^\s*[[(]?\s*(intro|verse|pre-?chorus|post-?chorus|chorus|bridge|outro|interlude|intermezzo|solo|refrain|hook|instrumental|ending|coda|riff|break|tag|vamp)\b[^\]):]*[\]):]?\s*/i;

/** Converts Ultimate-Guitar-style text (chord lines above lyric lines) to ChordPro. */
export function chordsOverLyricsToChordPro(text: string): string {
  const src = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out: string[] = [];
  let i = 0;
  // Lines read as the title or artist, so they aren't sung as lyrics too.
  const used = new Set<number>();

  // Title / artist / capo / key from the top of the sheet.
  for (let k = 0; k < Math.min(src.length, 12); k++) {
    const l = src[k].trim();
    let m = /^(.+?)\s+(?:chords|tabs?|ukulele chords)\s+by\s+(.+)$/i.exec(l);
    if (m) {
      out.push(`{title: ${m[1].trim()}}`, `{artist: ${m[2].trim()}}`);
      used.add(k);
      continue;
    }
    m = /^(?:title|song)\s*:\s*(.+)$/i.exec(l);
    if (m) {
      out.push(`{title: ${m[1].trim()}}`);
      used.add(k);
    }
    m = /^(?:artist|by)\s*:\s*(.+)$/i.exec(l);
    if (m) {
      out.push(`{artist: ${m[1].trim()}}`);
      used.add(k);
    }
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
    // Only a line standing alone above the song (before any section or chords) can be the title.
    const head: { l: string; k: number }[] = [];
    for (let k = 0; k < src.length; k++) {
      const l = src[k];
      if (/^\s*(```|~~~)/.test(l)) continue;
      // Stop at the song: chords (over the lyrics or inline like "[G]words") or a section.
      if (isChordLine(l) || SECTION_RE.test(l) || /\[[A-G][^\]]*\]/.test(l)) break;
      if (l.trim()) head.push({ l: l.trim(), k });
    }
    const first = head.find((h) => !/^(capo|key|tuning|tempo|bpm|description|difficulty|author)\b/i.test(h.l));
    if (first && first.l.length < 60 && head.length <= 4) {
      out.push(`{title: ${first.l}}`);
      used.add(first.k);
    }
  }

  let inDiagrams = false;
  while (i < src.length) {
    const line = src[i];
    const trimmed = line.trim();
    if (
      used.has(i) ||
      !trimmed ||
      /^(```|~~~)/.test(trimmed) ||
      /^(capo|key|tuning|tempo|bpm|description|difficulty|author|strumming|rating|transpose)\b/i.test(trimmed) ||
      /\b(chords|tabs?)\s+by\b/i.test(trimmed) ||
      /^[\dxXoO\s|.,-]+$/.test(trimmed) || // chord-diagram fingerings like "342" or "x32010"
      /^\d+\s*fr\b/i.test(trimmed)
    ) {
      i++;
      continue;
    }
    // A "CHORDS" heading starts the chord-diagram block: skip it until the song starts.
    if (/^chords:?$/i.test(trimmed)) {
      inDiagrams = true;
      i++;
      continue;
    }
    if (inDiagrams) {
      const words = trimmed.split(/\s+/).filter((w) => /^[a-z']{2,}$/i.test(w));
      if (SECTION_RE.test(line) || (!isChordLine(line) && words.length >= 3)) inDiagrams = false;
      else {
        i++;
        continue;
      }
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
        if (isChordSymbol(sym) || isNoChord(sym)) chords.push({ col: m.index, sym: isNoChord(sym) ? 'N.C.' : sym });
      }
      if (next !== undefined && next.trim() && !isChordLine(next) && !SECTION_RE.test(next)) {
        // Merge the chord line into the lyric line at the chord columns.
        let lyric = next;
        const maxCol = Math.max(...chords.map((c) => c.col));
        if (lyric.length < maxCol) lyric = lyric.padEnd(maxCol, ' ');
        let merged = '';
        let pos = 0;
        let lastChordCol = -1;
        for (const c of chords) {
          // A chord over the gap before a word belongs to that word.
          let col = c.col;
          if (lyric[col] === ' ' && lyric[col + 1] && lyric[col + 1] !== ' ') col++;
          // A chord over the middle of a word moves to the word's start, so lyrics stay whole —
          // unless an earlier chord already claimed that word; then it goes after the word.
          if (lyric[col] && lyric[col] !== ' ' && col > 0 && lyric[col - 1] !== ' ') {
            let start = col;
            while (start > 0 && lyric[start - 1] !== ' ') start--;
            if (start > lastChordCol) col = start;
            else {
              while (col < lyric.length && lyric[col] !== ' ') col++;
              if (col < lyric.length) col++;
            }
          }
          col = Math.max(col, pos);
          merged += lyric.slice(pos, col) + `[${c.sym}]`;
          pos = col;
          lastChordCol = col;
        }
        merged += lyric.slice(pos);
        out.push(merged.replace(/\s+$/, ''));
        i += 2;
      } else {
        // A chords-only line; "x4" repeats it.
        const rep = /(?:^|\s)[xX×](\d{1,2})\b|\b(\d{1,2})[xX×](?:\s|$)/.exec(line);
        const times = rep ? Math.min(16, parseInt(rep[1] ?? rep[2], 10)) : 1;
        const once = chords.map((c) => `[${c.sym}]`).join(' ');
        out.push(Array.from({ length: times }, () => once).join(' '));
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
  // Inline style: real chord symbols in brackets inside lines that also have lyrics.
  // ("[Chorus]" / "[Verse 1]" headings on their own line don't count.)
  let inlineLines = 0;
  for (const line of text.split('\n')) {
    const chords = [...line.matchAll(/\[([^\]]{1,12})\]/g)].filter((m) => parseChord(m[1].trim()));
    const words = line.replace(/\[[^\]]*\]/g, ' ').trim();
    if (chords.length && /[a-z]{2,}/i.test(words)) inlineLines++;
  }
  return inlineLines >= 2;
}

export function looksLikeChordSheet(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const chordLines = lines.filter((l) => isChordLine(l)).length;
  return chordLines >= 2 && chordLines / Math.max(1, lines.length) >= 0.15;
}

// ---- Export ---------------------------------------------------------------------

/**
 * A ChordPro chord sheet: chords and words. A section sung to several verses is written once
 * for each, its chords over each (a line with fewer verses giving its last); a chorus between
 * {soc} and {eoc}, the other sections as a comment heading them.
 */
export function writeChordPro(doc: TabDoc): string {
  const { meta } = doc;
  const out: string[] = [];
  if (meta.title) out.push(`{title: ${meta.title}}`);
  if (meta.artist) out.push(`{artist: ${meta.artist}}`);
  if (meta.key) out.push(`{key: ${meta.key}}`);
  out.push(`{tempo: ${Math.round(meta.tempo)}}`, `{time: ${meta.time}}`);
  // The song's sections: the lines from one heading to the next.
  const sections: { name?: string; lines: TabLine[] }[] = [];
  for (const line of doc.lines) {
    if (line.section !== undefined || !sections.length) sections.push({ name: line.section, lines: [] });
    sections[sections.length - 1].lines.push(line);
  }
  for (const sec of sections) {
    const verses = Math.max(1, ...sec.lines.map(lineVerses));
    const chorus = !!sec.name && /chorus|refrain|reff?\b/i.test(sec.name);
    for (let v = 0; v < verses; v++) {
      const heading = sec.name ? `${sec.name}${verses > 1 ? ` ${v + 1}` : ''}` : verses > 1 ? `Verse ${v + 1}` : undefined;
      if (chorus) out.push('', heading && heading !== 'Chorus' ? `{start_of_chorus: ${heading}}` : '{start_of_chorus}');
      else if (heading) out.push('', `{comment: ${heading}}`);
      for (const line of sec.lines) {
        if (!line.events.length) continue;
        const lv = lineVerse(line, v);
        let text = '';
        let lastChord: string | undefined;
        for (const e of line.events) {
          if (e.kind === 'bar') continue;
          const ev = e as NoteEvent | RestEvent;
          if (ev.chord && ev.chord !== lastChord) {
            text += `[${ev.chord}]`;
            lastChord = ev.chord;
          }
          const syl = isHeld(ev, lv) ? undefined : lyricOf(ev, lv);
          if (syl && !(ev.kind === 'note' && ev.tied)) text += syl.endsWith('-') ? syl.slice(0, -1) : syl + ' ';
        }
        if (text.trim()) out.push(text.trimEnd());
      }
      if (chorus) out.push('{end_of_chorus}');
    }
  }
  return out.join('\n') + '\n';
}
