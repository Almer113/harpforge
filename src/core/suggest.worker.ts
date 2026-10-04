// Ranks harmonicas off the main thread: it tries every harp in three octaves, which
// takes a while for long songs and would otherwise freeze typing.

import { suggestForChordSheet, suggestHarmonicas, type Suggestion } from './convert';
import type { TabDoc } from './htab/types';
import { getHarmonica, type HarmonicaSpec } from './instruments';

export interface SuggestRequest {
  id: number;
  doc: TabDoc;
  chordSheet: boolean;
  sourceSpec?: HarmonicaSpec;
  families?: string[];
  limit: number;
}

export interface SuggestResponse {
  id: number;
  suggestions: Suggestion[];
}

self.onmessage = (e: MessageEvent<SuggestRequest>) => {
  const { id, doc, chordSheet, sourceSpec, families, limit } = e.data;
  const suggestions = chordSheet
    ? suggestForChordSheet(doc, { limit, families })
    : suggestHarmonicas(doc, { limit, families, sourceHarp: sourceSpec ? getHarmonica(sourceSpec) : undefined });
  (self as unknown as Worker).postMessage({ id, suggestions } satisfies SuggestResponse);
};
