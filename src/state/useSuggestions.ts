// Harmonica suggestions for a song, worked out after typing pauses and in a worker,
// so the page never freezes. Falls back to working them out here (e.g. in tests).

import { useEffect, useRef, useState } from 'react';
import { suggestForChordSheet, suggestHarmonicas, type Suggestion } from '../core/convert';
import type { SuggestRequest, SuggestResponse } from '../core/suggest.worker';
import type { TabDoc } from '../core/htab/types';
import { getHarmonica, type HarmonicaSpec } from '../core/instruments';

let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, { req: Omit<SuggestRequest, 'id'>; resolve: (s: Suggestion[]) => void }>();

function computeHere({ doc, chordSheet, sourceSpec, families, limit }: Omit<SuggestRequest, 'id'>): Suggestion[] {
  return chordSheet ? suggestForChordSheet(doc, { limit, families }) : suggestHarmonicas(doc, { limit, families, sourceHarp: sourceSpec ? getHarmonica(sourceSpec) : undefined });
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('../core/suggest.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SuggestResponse>) => {
      waiting.get(e.data.id)?.resolve(e.data.suggestions);
      waiting.delete(e.data.id);
    };
    // The worker failed (couldn't load, or threw): answer what's waiting here, and stop using it.
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      for (const { req, resolve } of waiting.values()) resolve(computeHere(req));
      waiting.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

function compute(req: Omit<SuggestRequest, 'id'>): Promise<Suggestion[]> {
  const w = getWorker();
  if (!w) return Promise.resolve(computeHere(req));
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, { req, resolve });
    w.postMessage({ ...req, id });
  });
}

/** Suggestions for `doc` (null = nothing to suggest for). `pending` while they're being worked out. */
export function useSuggestions(
  doc: TabDoc | null,
  opts: { chordSheet: boolean; sourceSpec?: HarmonicaSpec; families?: string[]; limit?: number; delay?: number },
): { suggestions: Suggestion[]; pending: boolean } {
  const [state, setState] = useState<{ suggestions: Suggestion[]; pending: boolean }>({ suggestions: [], pending: !!doc });
  const latest = useRef(0);
  const familiesKey = opts.families?.join(',') ?? '';
  const sourceKey = opts.sourceSpec ? `${opts.sourceSpec.family}/${opts.sourceSpec.tuning}/${opts.sourceSpec.key}` : '';
  useEffect(() => {
    const ticket = ++latest.current;
    if (!doc) {
      setState({ suggestions: [], pending: false });
      return;
    }
    setState((s) => ({ ...s, pending: true }));
    const t = setTimeout(() => {
      void compute({ doc, chordSheet: opts.chordSheet, sourceSpec: opts.sourceSpec, families: opts.families, limit: opts.limit ?? 6 }).then((suggestions) => {
        if (ticket === latest.current) setState({ suggestions, pending: false });
      });
    }, opts.delay ?? 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, opts.chordSheet, sourceKey, familiesKey, opts.limit]);
  return state;
}
