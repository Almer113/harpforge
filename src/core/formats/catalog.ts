// The import and export formats by name: what the top bar and menus need right away.
// The readers and writers themselves (index.ts) load when you first import or export.

export type ImportKind = 'htab' | 'abc' | 'chordpro' | 'chordsheet' | 'guitartab' | 'jianpu' | 'musicxml' | 'mxl' | 'midi' | 'pdf';

export const IMPORT_ACCEPT = '.htab,.txt,.pdf,.tab,.abc,.cho,.chopro,.chordpro,.crd,.pro,.musicxml,.xml,.mxl,.mid,.midi,text/plain';

export const FORMAT_NAMES: Record<ImportKind, string> = {
  htab: 'HarpTab',
  abc: 'ABC notation',
  chordpro: 'ChordPro',
  chordsheet: 'Chord sheet (chords over lyrics)',
  guitartab: 'Guitar tab',
  jianpu: 'Numbered notation (jianpu)',
  pdf: 'PDF',
  musicxml: 'MusicXML',
  mxl: 'Compressed MusicXML',
  midi: 'MIDI',
};

export type ExportKind = 'htab' | 'notes' | 'abc' | 'musicxml' | 'midi' | 'chordpro' | 'jianpu';

/** Export formats. `loses` says what the format can't carry, shown before exporting. */
export const EXPORTS: { id: ExportKind; name: string; ext: string; mime: string; hint: string; loses?: string }[] = [
  { id: 'htab', name: 'HarpTab', ext: 'htab', mime: 'text/plain', hint: 'Full tab, re-importable' },
  { id: 'notes', name: 'Notes (no holes)', ext: 'htab', mime: 'text/plain', hint: 'Pitch names instead of holes — re-import for any harmonica', loses: 'Which holes and bends were used' },
  { id: 'abc', name: 'ABC notation', ext: 'abc', mime: 'text/vnd.abc', hint: 'Notes + tab line + lyrics', loses: 'Bends show as pitches' },
  { id: 'musicxml', name: 'MusicXML', ext: 'musicxml', mime: 'application/vnd.recordare.musicxml+xml', hint: 'For MuseScore, Finale, Sibelius…', loses: 'The tab is a lyric line after the verses; comments are left out' },
  { id: 'midi', name: 'MIDI', ext: 'mid', mime: 'audio/midi', hint: 'Plays in any MIDI app: the tune with its words as sung, repeats played out, and the backing on a track of its own', loses: 'No tab or sections; repeat signs become the notes played again' },
  { id: 'chordpro', name: 'ChordPro', ext: 'cho', mime: 'text/plain', hint: 'Chords + lyrics only', loses: 'No melody or tab; only verse 1 of the lyrics; no repeat signs or endings' },
  { id: 'jianpu', name: 'Numbered notation', ext: 'txt', mime: 'text/plain', hint: 'Jianpu (1=C …), common for tremolo', loses: 'Harmonica chords keep only their top note; notes the harp can’t play become rests (and lose their syllable); no tab; only verse 1 of the lyrics' },
];
