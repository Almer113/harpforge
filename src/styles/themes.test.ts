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

// (Named colours too, as a value: `color: red`, not the word in a class name or a comment.)
const NAMED = 'white|black|red|green|blue|gr[ae]y|orange|yellow|purple|pink|brown|silver|gold|navy|teal|maroon|olive|lime|aqua|cyan|magenta|fuchsia';
const COLOUR = new RegExp(`#[0-9a-fA-F]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\\(|[:,(\\s](?:${NAMED})\\s*[;,)!}]`, 'g');
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
    // (Allowed: a white page under an imported PDF, as it's read.)
    const allowed = ['/formats/pdf.ts'];
    const stray = Object.entries(code)
      .filter(([path]) => !allowed.some((a) => path.endsWith(a)))
      .flatMap(([path, text]) => found(text.replace(/\/\/.*$/gm, '')).map((l) => `${path} ${l}`))
      // (Not colours: "#" in strings that aren't colours, like note names and ids.)
      .filter((l) => /['"`]#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?['"`]|\b(?:rgba?|hsla?)\(|\b(?:fill|stroke|color|background): ?['"](?!var\(|currentColor|none|transparent)/.test(l));
    expect(stray).toEqual([]);
  });

  it('every name a stylesheet uses is set somewhere (a misspelt one would fall back to nothing)', () => {
    const all = [...Object.values(sheets), ...Object.values(code)].join('\n');
    // (Set: `--x: …` in a stylesheet, or by the code: setProperty('--x', …), style={{ ['--x' as string]: … }}.)
    const set = new Set([...all.matchAll(/(?<!var\()(--[\w-]+)(?:['"](?: as string\])?)?\s*[:,]/g)].map((m) => m[1]));
    // (A name with a fallback, var(--x, …), needn't be set; the code's own var(--x) must be.)
    const used = new Set([...Object.values(sheets), ...Object.values(code)].flatMap((t) => [...t.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1])));
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

const rgbOf = (hex: string) => {
  // (Only plain #rgb / #rrggbb: anything else would pass unseen, so it fails here.)
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) throw new Error(`not a plain colour: ${hex}`);
  const h = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
/** `top` at `alpha` over `under` (a tint as it's seen). */
const over = (top: string, alpha: number, under: string) =>
  `#${rgbOf(top)
    .map((c, i) => Math.round(c * alpha + rgbOf(under)[i] * (1 - alpha)))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;

/** WCAG contrast of two #rrggbb colours. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const h = rgbOf(hex).map((c) => c.toString(16).padStart(2, '0')).join('');
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
  const own = /^--(metal|comb|hole|reed|paper|blow-soft|draw-soft)/;

  it.each(['light', 'paper'] as const)('%s sets every colour Dark does (none left dark by accident)', (name) => {
    const dark = Object.keys(palette(':root')).filter((k) => !own.test(k) && !/^--(radius|mono|topbar-h)$/.test(k));
    const css = sheets['./themes.css'];
    const at = css.indexOf(`${THEMES[name]} {`);
    const set = css.slice(at, css.indexOf('}', at));
    expect(dark.filter((k) => !set.includes(`${k}:`))).toEqual([]);
  });

  it.each(Object.keys(THEMES) as (keyof typeof THEMES)[])('%s: text and marks are readable on every surface', (name) => {
    const p = palette(THEMES[name]);
    const surfaces = ['--bg', '--bg-2', '--panel', '--panel-2', '--menu', '--toast', '--sunk', '--sunk-2'];
    const low: string[] = [];
    const need = (fg: string, min: number, on = surfaces) => {
      for (const bg of on) {
        const r = contrast(p[fg], p[bg]);
        if (r < min) low.push(`${fg} on ${bg}: ${r.toFixed(2)} (needs ${min})`);
      }
    };
    // Text (4.5:1): words, holes, chords, section names, the editor's colouring.
    for (const t of ['--text', '--muted', '--brass', '--brass-2', '--blow', '--draw', '--pitch', '--danger', '--ok', '--warn', '--hl-value', '--hl-lyric', '--hl-group', '--staff-ink', '--ink-strong']) need(t, 4.5);
    // Small print and hints (as Dark has them), and the focus ring (3:1).
    need('--faint', 3.5);
    need('--focus', 3);
    // Text on a coloured button or a lit hole.
    need('--on-brass', 4.5, ['--brass']);
    need('--on-blow', 4.5, ['--blow']);
    need('--on-draw', 4.5, ['--draw']);
    need('--on-danger', 3, ['--danger']);
    // Text on a wash of colour: a blow or draw card, the playing card, Step entry when on.
    const washed = (fg: string, tint: string, alpha: number, under: string[], min = 4.5) => {
      for (const bg of under) {
        const r = contrast(p[fg], over(p[tint], alpha, p[bg]));
        if (r < min) low.push(`${fg} on ${Math.round(alpha * 100)}% ${tint} over ${bg}: ${r.toFixed(2)} (needs ${min})`);
      }
    };
    washed('--blow', '--blow', 0.14, ['--sunk-2', '--lane-now', '--panel']);
    washed('--draw', '--draw', 0.14, ['--sunk-2', '--lane-now', '--panel']);
    washed('--brass-2', '--brass', 0.16, ['--panel']);
    washed('--on-danger-soft', '--danger', 0.22, ['--panel', '--bg-2']);
    expect(low).toEqual([]);
  });

  it('the harmonica lights its holes in its own colours, bright on the black holes in every theme', () => {
    const p = palette(':root');
    for (const t of ['--reed-blow', '--reed-draw', '--reed-target-2']) expect(contrast(p[t], p['--hole'])).toBeGreaterThan(7);
    const css = sheets['./themes.css'];
    for (const theme of [THEMES.light, THEMES.paper]) {
      const at = css.indexOf(`${theme} {`);
      expect(css.slice(at, css.indexOf('}', at))).not.toMatch(/--(reed|metal|comb|hole)/);
    }
    // (The lit reeds use them, not the theme's pens.)
    expect(sheets['./harmonica.css']).not.toMatch(/\.(?:blow|draw)-on \.reed[^{]*\{[^}]*var\(--(?:blow|draw)\)/);
  });

  // The print view's sheet and printing from the browser's menu: ink on white, whatever the theme.
  it.each([
    ['the print view (.paper)', '.paper'],
    ['printing from the browser', 'html:not(.printing), html[data-theme]:not(.printing)'],
  ])('%s: the same ink in every theme, readable on white', (_name, selector) => {
    const css = sheets['./themes.css'];
    const at = css.indexOf(`${selector} {`);
    expect(at).toBeGreaterThan(-1);
    const own = Object.fromEntries([...css.slice(at, css.indexOf('}', at)).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    // Every colour a sheet draws with is the paper's own (not left to the theme).
    const sheetInk = ['--text', '--muted', '--faint', '--border', '--border-2', '--panel', '--panel-2', '--bg-2', '--brass', '--brass-2', '--blow', '--draw', '--pitch', '--danger', '--ok', '--warn', '--focus', '--staff-ink', '--ink-strong', '--hilite', '--contrast', '--blow-soft', '--draw-soft'];
    expect(sheetInk.filter((k) => !(k in own))).toEqual([]);
    const white = '#ffffff';
    const low = ['--text', '--muted', '--brass-2', '--blow', '--draw', '--pitch', '--danger', '--ok', '--staff-ink', '--ink-strong']
      .filter((t) => contrast(own[t], white) < 4.5)
      .concat(['--faint', '--focus', '--warn'].filter((t) => contrast(own[t], white) < 3));
    expect(low).toEqual([]);
  });

  it('index.html colours the browser bar as the theme’s --bg (before the app sets it)', () => {
    const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
    const meta = /theme-color" content="(#[0-9a-f]+)"/.exec(html)?.[1];
    const early = /t === 'light' \? '(#[0-9a-f]+)' : '(#[0-9a-f]+)'/.exec(html);
    expect([meta, early?.[1], early?.[2]]).toEqual([palette(':root')['--bg'], palette(THEMES.light)['--bg'], palette(THEMES.paper)['--bg']]);
  });

  it('printing from the browser’s menu uses the paper ink in every theme (outweighing a theme)', () => {
    const css = sheets['./themes.css'];
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toContain('html[data-theme]:not(.printing)');
  });
});
