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

/** A theme's colours as themes.css sets them (Light and Paper on top of Dark). */
function palette(selector: string): Record<string, string> {
  const css = sheets['./themes.css'];
  const block = (sel: string) => {
    const at = css.indexOf(`${sel} {`);
    if (at < 0) throw new Error(`no ${sel} in themes.css`);
    const body = css.slice(at, css.indexOf('}', at));
    return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  };
  const dark = block(':root');
  return selector === ':root' ? dark : { ...dark, ...block(selector) };
}
const THEMES = { dark: ':root', light: ":root[data-theme='light']", paper: ":root[data-theme='paper']" };

/** WCAG contrast of two #rrggbb colours. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const h = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
    const [r, g, bl] = [0, 2, 4].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe('the themes (Phase 16b)', () => {
  // The harmonica keeps its own look; the paper page is white in every theme.
  const own = /^--(metal|comb|hole|paper|blow-soft|draw-soft)/;

  it.each(['light', 'paper'] as const)('%s sets every colour Dark does (none left dark by accident)', (name) => {
    const dark = Object.keys(palette(':root')).filter((k) => !own.test(k) && !/^--(radius|mono|topbar-h)$/.test(k));
    const css = sheets['./themes.css'];
    const at = css.indexOf(`${THEMES[name]} {`);
    const set = css.slice(at, css.indexOf('}', at));
    expect(dark.filter((k) => !set.includes(`${k}:`))).toEqual([]);
  });

  it.each(Object.keys(THEMES) as (keyof typeof THEMES)[])('%s: text and marks are readable on every surface', (name) => {
    const p = palette(THEMES[name]);
    const surfaces = ['--bg', '--bg-2', '--panel', '--panel-2'];
    const low: string[] = [];
    const need = (fg: string, min: number, on = surfaces) => {
      for (const bg of on) {
        const r = contrast(p[fg], p[bg]);
        if (r < min) low.push(`${fg} on ${bg}: ${r.toFixed(2)} (needs ${min})`);
      }
    };
    // Text (4.5:1): words, holes, chords, section names, the editor's colouring.
    for (const t of ['--text', '--muted', '--brass', '--brass-2', '--blow', '--draw', '--pitch', '--danger', '--ok', '--hl-value', '--hl-lyric', '--hl-group', '--staff-ink', '--ink-strong']) need(t, 4.5);
    // Small print and hints (as Dark has them), and lines that must be seen (3:1).
    need('--faint', 3.5);
    for (const t of ['--focus', '--warn']) need(t, 3);
    // Text on a coloured button or a lit hole.
    need('--on-brass', 4.5, ['--brass']);
    need('--on-blow', 4.5, ['--blow']);
    need('--on-draw', 4.5, ['--draw']);
    need('--on-danger', 3, ['--danger']);
    expect(low).toEqual([]);
  });
});
