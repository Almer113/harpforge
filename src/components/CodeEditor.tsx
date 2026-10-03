// A lightweight .htab editor: a transparent textarea over a syntax-highlighted
// mirror, with error squiggles.

import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type { ParseIssue } from '../core/htab/types';

export interface CodeEditorHandle {
  select(start: number, end: number): void;
}

interface Props {
  value: string;
  onChange(v: string): void;
  issues: ParseIssue[];
}

const TOKEN_RE =
  /(\[[^\]]*\])|(\|\]|\|\||\|:|:\|\|?|\|)|(-?\(|[(){}])|(<?-<?\d{1,2}[^\s|[\](){}~]*~*)|(<?\+?<?\d{1,2}[^\s|[\](){}~]*~*)|([A-G][#b]{0,2}-?\d?~*)|((?<=\s|^)\.~*)|(~+)/g;
const TOKEN_CLASSES = ['hl-chord', 'hl-bar', 'hl-group', 'hl-draw', 'hl-blow', 'hl-pitch', 'hl-rest', 'hl-hold'];

function classify(text: string, issues: ParseIssue[]): string[] {
  const cls: string[] = new Array(text.length).fill('');
  const mark = (a: number, b: number, c: string) => {
    for (let i = a; i < b && i < text.length; i++) cls[i] = cls[i] ? cls[i] + ' ' + c : c;
  };
  let offset = 0;
  let inHeader = false;
  let headerDone = false;
  for (const line of text.split('\n')) {
    const start = offset;
    offset += line.length + 1;
    const t = line.trim();
    if (!headerDone && t === '---') {
      mark(start, start + line.length, 'hl-fence');
      if (inHeader) headerDone = true;
      inHeader = !inHeader;
      continue;
    }
    if (t !== '' && !inHeader) headerDone = true;
    if (inHeader) {
      const colon = line.indexOf(':');
      if (colon > 0) {
        mark(start, start + colon + 1, 'hl-key');
        mark(start + colon + 1, start + line.length, 'hl-value');
      }
      continue;
    }
    if (t.startsWith('#')) {
      mark(start, start + line.length, 'hl-comment');
      continue;
    }
    if (t.startsWith('@')) {
      mark(start, start + line.length, 'hl-section');
      continue;
    }
    if (/^w:/i.test(t)) {
      mark(start, start + line.length, 'hl-lyric');
      continue;
    }
    let body = line;
    const hash = line.search(/(^|\s)#/);
    if (hash >= 0) {
      mark(start + hash, start + line.length, 'hl-comment');
      body = line.slice(0, hash);
    }
    TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(body))) {
      const g = m.slice(1).findIndex((x) => x !== undefined);
      if (g >= 0) mark(start + m.index, start + m.index + m[0].length, TOKEN_CLASSES[g]);
      if (m[0].length === 0) TOKEN_RE.lastIndex++;
    }
  }
  for (const is of issues) mark(is.span.start, is.span.end, is.severity === 'error' ? 'hl-err' : 'hl-warn');
  return cls;
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor({ value, onChange, issues }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLPreElement>(null);

  useImperativeHandle(ref, () => ({
    select(start, end) {
      const el = ta.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(start, end);
      // Scroll the selection into view.
      const line = value.slice(0, start).split('\n').length - 1;
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      const target = line * lh - el.clientHeight / 2;
      el.scrollTop = Math.max(0, target);
    },
  }));

  const highlighted = useMemo(() => {
    const cls = classify(value, issues);
    const out: React.ReactNode[] = [];
    let i = 0;
    while (i < value.length) {
      let j = i + 1;
      while (j < value.length && cls[j] === cls[i] && value[j] !== '\n') j++;
      out.push(cls[i] ? <span key={i} className={cls[i]}>{value.slice(i, j)}</span> : value.slice(i, j));
      i = j;
    }
    out.push('\n');
    return out;
  }, [value, issues]);

  const lineCount = value.split('\n').length;

  return (
    <div className="code-editor">
      <div className="gutter" aria-hidden>
        <div className="gutter-inner" style={{ transform: `translateY(${-(ta.current?.scrollTop ?? 0)}px)` }}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
      </div>
      <div className="code-area">
        <pre ref={mirror} className="code-mirror" aria-hidden>
          {highlighted}
        </pre>
        <textarea
          ref={ta}
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          wrap="off"
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            const t = e.currentTarget;
            if (mirror.current) {
              mirror.current.scrollTop = t.scrollTop;
              mirror.current.scrollLeft = t.scrollLeft;
            }
            const g = t.parentElement?.previousElementSibling?.firstElementChild as HTMLElement | null;
            if (g) g.style.transform = `translateY(${-t.scrollTop}px)`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: a, selectionEnd: b } = el;
              onChange(value.slice(0, a) + '  ' + value.slice(b));
              requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
            }
          }}
        />
      </div>
    </div>
  );
});
