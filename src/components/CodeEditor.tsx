// A lightweight .htab editor: a transparent textarea over a syntax-highlighted
// mirror, with error squiggles. Long lines wrap; line numbers sit beside each line.

import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
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
  const cls: string[] = Array.from({ length: text.length }, () => '');
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
  for (const is of issues) if (is.severity !== 'info') mark(is.span.start, is.span.end, is.severity === 'error' ? 'hl-err' : 'hl-warn');
  return cls;
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor({ value, onChange, issues }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  // The text this editor last produced: anything else (undo, an edit elsewhere) came from outside.
  const emitted = useRef(value);
  const previous = useRef(value);

  useImperativeHandle(ref, () => ({
    select(start, end) {
      const el = ta.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(start, end);
      // Scroll the selection's line into view (lines wrap, so measure it in the mirror).
      const line = value.slice(0, start).split('\n').length - 1;
      const lineEl = mirror.current?.children[line] as HTMLElement | undefined;
      if (lineEl) el.scrollTop = Math.max(0, lineEl.offsetTop - el.clientHeight / 2);
    },
  }));

  // Undo/redo replace the whole text: keep the caret where the change happened, not at the end.
  useLayoutEffect(() => {
    const el = ta.current;
    const before = previous.current;
    previous.current = value;
    if (!el || value === emitted.current || document.activeElement !== el) return;
    emitted.current = value;
    let p = 0;
    while (p < value.length && p < before.length && value[p] === before[p]) p++;
    el.setSelectionRange(p, p);
  }, [value]);

  // One block per line, so long lines can wrap and line numbers stay beside their line.
  const highlighted = useMemo(() => {
    const cls = classify(value, issues);
    const lines: React.ReactNode[] = [];
    let i = 0;
    for (const line of value.split('\n')) {
      const parts: React.ReactNode[] = [];
      const end = i + line.length;
      let k = i;
      while (k < end) {
        let j = k + 1;
        while (j < end && cls[j] === cls[k]) j++;
        parts.push(cls[k] ? <span key={k} className={cls[k]}>{value.slice(k, j)}</span> : value.slice(k, j));
        k = j;
      }
      lines.push(<div key={i} className="cl">{parts.length ? parts : '​'}</div>);
      i = end + 1;
    }
    return lines;
  }, [value, issues]);

  return (
    <div className="code-editor">
      <div className="code-area">
        <div ref={mirror} className="code-mirror" aria-hidden>
          {highlighted}
        </div>
        <textarea
          ref={ta}
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label="HarpTab text"
          onChange={(e) => {
            emitted.current = e.target.value;
            onChange(e.target.value);
          }}
          onScroll={(e) => {
            if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onKeyDown={(e) => {
            // Tab indents; Escape leaves the editor, so the keyboard can move on.
            if (e.key === 'Escape') e.currentTarget.blur();
            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: a, selectionEnd: b } = el;
              const next = value.slice(0, a) + '  ' + value.slice(b);
              emitted.current = next;
              onChange(next);
              requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
            }
          }}
        />
      </div>
    </div>
  );
});
