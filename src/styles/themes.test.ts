/// <reference types="node" />
// Phase 16a: every colour is named in themes.css, so a theme can change all of them. A colour
// written anywhere else would stay the same in every theme.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// (Read from disk: the test runner hands a stylesheet's import back empty.)
const dir = new URL('.', import.meta.url);
const sheets = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => [`./${f}`, readFileSync(new URL(f, dir), 'utf8')]),
);
const code = import.meta.glob(['../**/*.tsx', '../**/*.ts', '!../**/*.test.*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\b(?:white|black)\b(?!-)/g;
const found = (text: string) =>
  text
    .replace(/\/\*[^]*?\*\//g, '')
    .split('\n')
    .flatMap((line, k) => ((line.match(COLOUR) ?? []).length ? [`${k + 1}: ${line.trim()}`] : []));

describe('colours', () => {
  it('the stylesheets use the named colours only (themes.css names them)', () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(10);
    const stray = Object.entries(sheets)
      .filter(([path]) => !path.endsWith('/themes.css'))
      .flatMap(([path, text]) => found(text).map((l) => `${path} ${l}`));
    expect(stray).toEqual([]);
  });

  it('the components don’t write colours of their own', () => {
    // (Allowed: the staff's ink if the page has none, and a white page under an imported PDF.)
    const allowed = ['/StaffView.tsx', '/formats/pdf.ts'];
    const stray = Object.entries(code)
      .filter(([path]) => !allowed.some((a) => path.endsWith(a)))
      .flatMap(([path, text]) => found(text.replace(/\/\/.*$/gm, '')).map((l) => `${path} ${l}`))
      // (Not colours: "#" in strings that aren't colours, like note names and ids.)
      .filter((l) => /['"`]#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?['"`]|rgba?\(|\bfill: ?['"]|color: ?['"]/.test(l));
    expect(stray).toEqual([]);
  });

  it('every name a stylesheet uses is set somewhere (a misspelt one would fall back to nothing)', () => {
    const all = [...Object.values(sheets), ...Object.values(code)].join('\n');
    const set = new Set([...all.matchAll(/(--[\w-]+)(?:['"](?: as string\])?)?\s*[:,]/g)].map((m) => m[1]));
    // (A name with a fallback, var(--x, …), needn't be set.)
    const used = new Set(Object.values(sheets).flatMap((t) => [...t.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1])));
    expect([...used].filter((v) => !set.has(v))).toEqual([]);
  });
});
