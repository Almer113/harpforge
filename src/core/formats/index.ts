// Format registry: detects what a file is, imports it, and exports documents.

import { parseHtab } from '../htab/parser';
import { serializeHtab } from '../htab/serializer';
import type { TabDoc } from '../htab/types';
import type { Harmonica } from '../instruments';
import { parseAbc, writeAbc } from './abc';
import { looksLikeChordPro, looksLikeChordSheet, parseChordPro, parseChordSheetText, writeChordPro } from './chordpro';
import type { Imported } from './common';
import { slugify } from './common';
import { parseMidi, writeMidi } from './midi';
import { parseMusicXml, unzipMxl, writeMusicXml } from './musicxml';

export type { Imported } from './common';

export type ImportKind = 'htab' | 'abc' | 'chordpro' | 'chordsheet' | 'musicxml' | 'mxl' | 'midi';

export const IMPORT_ACCEPT = '.htab,.txt,.abc,.cho,.chopro,.chordpro,.crd,.pro,.musicxml,.xml,.mxl,.mid,.midi,text/plain';

export const FORMAT_NAMES: Record<ImportKind, string> = {
  htab: 'HarpTab',
  abc: 'ABC notation',
  chordpro: 'ChordPro',
  chordsheet: 'Chord sheet (chords over lyrics)',
  musicxml: 'MusicXML',
  mxl: 'Compressed MusicXML',
  midi: 'MIDI',
};

/** Guesses the format of text content. */
export function sniffText(text: string): ImportKind {
  const t = text.trimStart();
  if (/^X:\s*\d*/m.test(t) && /^K:/m.test(t)) return 'abc';
  if (t.startsWith('<?xml') || /<score-partwise|<score-timewise/.test(t.slice(0, 2000))) return 'musicxml';
  if (t.startsWith('---')) return 'htab';
  if (looksLikeChordPro(t)) return 'chordpro';
  if (looksLikeChordSheet(t)) return 'chordsheet';
  return 'htab';
}

export function detectKind(filename: string, bytes: Uint8Array): ImportKind {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'mid' || ext === 'midi' || (bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64)) return 'midi';
  if (ext === 'mxl' || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return 'mxl';
  if (ext === 'abc') return 'abc';
  if (['cho', 'chopro', 'chordpro', 'crd', 'pro'].includes(ext)) return 'chordpro';
  if (ext === 'musicxml' || ext === 'xml') return 'musicxml';
  if (ext === 'htab') return 'htab';
  return sniffText(decodeText(bytes));
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function importText(text: string, kind: ImportKind = sniffText(text)): Imported {
  switch (kind) {
    case 'abc':
      return parseAbc(text);
    case 'chordpro':
      return parseChordPro(text);
    case 'chordsheet':
      return parseChordSheetText(text);
    case 'musicxml':
      return parseMusicXml(text);
    default: {
      const { doc, issues } = parseHtab(text);
      return { doc, warnings: issues.filter((i) => i.severity === 'error').slice(0, 5).map((i) => i.message), format: 'HarpTab' };
    }
  }
}

export function importBytes(filename: string, bytes: Uint8Array): Imported & { kind: ImportKind } {
  const kind = detectKind(filename, bytes);
  if (kind === 'midi') return { ...parseMidi(bytes), kind };
  if (kind === 'mxl') return { ...parseMusicXml(unzipMxl(bytes)), kind };
  return { ...importText(decodeText(bytes), kind), kind };
}

// ---- Export ---------------------------------------------------------------------

export type ExportKind = 'htab' | 'abc' | 'musicxml' | 'midi' | 'chordpro';

export const EXPORTS: { id: ExportKind; name: string; ext: string; mime: string; hint: string }[] = [
  { id: 'htab', name: 'HarpTab', ext: 'htab', mime: 'text/plain', hint: 'Full tab, re-importable' },
  { id: 'abc', name: 'ABC notation', ext: 'abc', mime: 'text/vnd.abc', hint: 'Notes + tab line + lyrics' },
  { id: 'musicxml', name: 'MusicXML', ext: 'musicxml', mime: 'application/vnd.recordare.musicxml+xml', hint: 'For MuseScore, Finale, Sibelius…' },
  { id: 'midi', name: 'MIDI', ext: 'mid', mime: 'audio/midi', hint: 'Plays in any MIDI app' },
  { id: 'chordpro', name: 'ChordPro', ext: 'cho', mime: 'text/plain', hint: 'Chords + lyrics only' },
];

export function exportDoc(kind: ExportKind, doc: TabDoc, harp: Harmonica, htabText?: string): { filename: string; data: string | Uint8Array; mime: string } {
  const info = EXPORTS.find((e) => e.id === kind)!;
  const filename = `${slugify(doc.meta.title ?? 'tab')}.${info.ext}`;
  let data: string | Uint8Array;
  switch (kind) {
    case 'htab':
      data = htabText ?? serializeHtab(doc);
      break;
    case 'abc':
      data = writeAbc(doc, harp, { tabLine: true }).text;
      break;
    case 'musicxml':
      data = writeMusicXml(doc, harp);
      break;
    case 'midi':
      data = writeMidi(doc, harp);
      break;
    case 'chordpro':
      data = writeChordPro(doc);
      break;
  }
  return { filename, data, mime: info.mime };
}
