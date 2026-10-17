// Format registry: detects what a file is, imports it, and exports documents.

import { tabToNotes } from '../convert';
import { parseHtab } from '../htab/parser';
import { serializeHtab } from '../htab/serializer';
import type { TabDoc } from '../htab/types';
import type { Harmonica } from '../instruments';
import { parseAbc, writeAbc } from './abc';
import { isChordLine, looksLikeChordPro, looksLikeChordSheet, parseChordPro, parseChordSheetText, writeChordPro } from './chordpro';
import { countTabLines, looksLikeGuitarTab, parseGuitarTab } from './guitartab';
import { looksLikeJianpu, parseJianpu, writeJianpu } from './jianpu';
import type { Imported } from './common';
import { slugify } from './common';
import { parseMidi, writeMidi, type MidiExportOptions } from './midi';
import { parseMusicXml, unzipMxl, writeMusicXml } from './musicxml';
import { isMscz, parseMuseScore, unzipMscz } from './musescore';
import { unzipSync } from 'fflate';

export type { Imported } from './common';
export * from './catalog';
import { EXPORTS, type ExportKind, type ImportKind } from './catalog';

/** Normalises pasted text: line endings, non-breaking/odd spaces, zero-width characters. */
export function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
}

/** Guesses the format of text content. */
export function sniffText(text: string): ImportKind {
  const t = normalizeText(text).trimStart();
  if (/^X:\s*\d*/m.test(t) && /^K:/m.test(t)) return 'abc';
  if (/<museScore[\s>]/.test(t.slice(0, 2000))) return 'mscx';
  if (t.startsWith('<?xml') || /<score-partwise|<score-timewise/.test(t.slice(0, 2000))) return 'musicxml';
  if (looksLikeJianpu(t)) return 'jianpu';
  if (t.startsWith('---')) return 'htab';
  if (looksLikeChordPro(t)) return 'chordpro';
  const tabLines = countTabLines(t);
  const chordLines = t.split('\n').filter((l) => isChordLine(l)).length;
  if (looksLikeGuitarTab(t) && tabLines >= chordLines) return 'guitartab';
  if (looksLikeChordSheet(t)) return 'chordsheet';
  return 'htab';
}

export function detectKind(filename: string, bytes: Uint8Array): ImportKind {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf' || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) return 'pdf';
  if (ext === 'mid' || ext === 'midi' || (bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64)) return 'midi';
  if (ext === 'mscz') return 'mscz';
  if (ext === 'mscx') return 'mscx';
  // A zip: by what's in it (a MuseScore score, else compressed MusicXML).
  if (ext === 'mxl' || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return ext !== 'mxl' && isMscz(zipNames(bytes)) ? 'mscz' : 'mxl';
  if (ext === 'abc') return 'abc';
  if (['cho', 'chopro', 'chordpro', 'crd', 'pro'].includes(ext)) return 'chordpro';
  if (ext === 'musicxml' || ext === 'xml') return 'musicxml';
  if (ext === 'htab') return 'htab';
  return sniffText(decodeText(bytes));
}

/** The names of the files in a zip (without unpacking them). */
function zipNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return false;
      },
    });
  } catch {
    // (Not a zip after all: no names.)
  }
  return names;
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function importText(raw: string, kind: ImportKind = sniffText(raw)): Imported {
  const text = normalizeText(raw);
  switch (kind) {
    case 'abc':
      return parseAbc(text);
    case 'chordpro':
      return parseChordPro(text);
    case 'chordsheet':
      return parseChordSheetText(text);
    case 'guitartab':
      return parseGuitarTab(text);
    case 'jianpu':
      return parseJianpu(text);
    case 'musicxml':
      return parseMusicXml(text);
    case 'mscx':
      return parseMuseScore(text);
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
  if (kind === 'mscz') return { ...parseMuseScore(unzipMscz(bytes)), kind };
  if (kind === 'pdf') throw new Error('PDFs are read asynchronously — use importPdf().');
  return { ...importText(decodeText(bytes), kind), kind };
}

// ---- Export ---------------------------------------------------------------------

export function exportDoc(kind: ExportKind, doc: TabDoc, harp: Harmonica, htabText?: string, opts: MidiExportOptions = {}): { filename: string; data: string | Uint8Array; mime: string } {
  const info = EXPORTS.find((e) => e.id === kind)!;
  const filename = `${slugify(doc.meta.title ?? 'tab')}${kind === 'notes' ? '-notes' : ''}.${info.ext}`;
  let data: string | Uint8Array;
  switch (kind) {
    case 'htab':
      data = htabText ?? serializeHtab(doc);
      break;
    case 'abc':
      data = writeAbc(doc, harp, { tabLine: true, restWords: true }).text;
      break;
    case 'musicxml':
      data = writeMusicXml(doc, harp);
      break;
    case 'midi':
      data = writeMidi(doc, harp, opts);
      break;
    case 'chordpro':
      data = writeChordPro(doc);
      break;
    case 'jianpu':
      data = writeJianpu(doc, harp);
      break;
    case 'notes':
      data = serializeHtab(tabToNotes(doc, harp).doc);
      break;
  }
  return { filename, data, mime: info.mime };
}
