// A lightweight .htab editor: a transparent textarea over a syntax-highlighted
// mirror, with error squiggles. Long lines wrap; line numbers sit beside each line.

import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
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

/** One line's highlighting: [start, end, classes] within the line. */
type Span = [number, number, string];

/**
 * Highlighting, line by line (the header's state carries from line to line). Issues are
 * moved onto the lines they fall in, so a line's spans only change when the line does.
 */
function classifyLines(text: string, issues: ParseIssue[]): { text: string; spans: Span[] }[] {
  const lines = text.split('\n');
  const out: { text: string; spans: Span[] }[] = [];
  let inHeader = false;
  let headerDone = false;
  for (const line of lines) {
    const spans: Span[] = [];
    out.push({ text: line, spans });
    const t = line.trim();
    if (!headerDone && t === '---') {
      spans.push([0, line.length, 'hl-fence']);
      if (inHeader) headerDone = true;
      inHeader = !inHeader;
      continue;
    }
    if (t !== '' && !inHeader) headerDone = true;
    if (inHeader) {
      const colon = line.indexOf(':');
      if (colon > 0) {
        spans.push([0, colon + 1, 'hl-key']);
        spans.push([colon + 1, line.length, 'hl-value']);
      }
      continue;
    }
    if (t.startsWith('#')) {
      spans.push([0, line.length, 'hl-comment']);
      continue;
    }
    if (t.startsWith('@')) {
      spans.push([0, line.length, 'hl-section']);
      continue;
    }
    if (/^w:/i.test(t)) {
      spans.push([0, line.length, 'hl-lyric']);
      continue;
    }
    let body = line;
    const hash = line.search(/(^|\s)#/);
    if (hash >= 0) {
      spans.push([hash, line.length, 'hl-comment']);
      body = line.slice(0, hash);
    }
    TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(body))) {
      const g = m.slice(1).findIndex((x) => x !== undefined);
      if (g >= 0) spans.push([m.index, m.index + m[0].length, TOKEN_CLASSES[g]]);
      if (m[0].length === 0) TOKEN_RE.lastIndex++;
    }
  }
  // Issues (which can span lines) onto the lines they touch.
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  for (const is of issues) {
    if (is.severity === 'info') continue;
    const c = is.severity === 'error' ? 'hl-err' : 'hl-warn';
    for (let li = 0; li < lines.length; li++) {
      const a = Math.max(is.span.start, starts[li]) - starts[li];
      const b = Math.min(is.span.end, starts[li] + lines[li].length) - starts[li];
      if (b > a) out[li].spans.push([a, b, c]);
    }
  }
  return out;
}

/** One highlighted line (redrawn only when its text or highlighting changes). */
const CodeLine = memo(function CodeLine({ text, spans }: { text: string; spans: string }) {
  if (!text) return <div className="cl">{'\u200b'}</div>;
  const list: Span[] = spans ? JSON.parse(spans) : [];
  // Classes per character, then runs of the same classes.
  const cls: string[] = Array.from({ length: text.length }, () => '');
  for (const [a, b, c] of list) for (let i = a; i < b && i < text.length; i++) cls[i] = cls[i] ? cls[i] + ' ' + c : c;
  const parts: React.ReactNode[] = [];
  for (let k = 0; k < text.length; ) {
    let j = k + 1;
    while (j < text.length && cls[j] === cls[k]) j++;
    parts.push(cls[k] ? <span key={k} className={cls[k]}>{text.slice(k, j)}</span> : text.slice(k, j));
    k = j;
  }
  return <div className="cl">{parts}</div>;
});

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

  // One block per line, so long lines can wrap and line numbers stay beside their line. Lines
  // are keyed by their number and memoised: typing redraws only the line being typed in.
  const lines = useMemo(() => classifyLines(value, issues), [value, issues]);

  return (
    <div className="code-editor">
      <div className="code-area">
        <div ref={mirror} className="code-mirror" aria-hidden>
          {lines.map((l, i) => (
            <CodeLine key={i} text={l.text} spans={l.spans.length ? JSON.stringify(l.spans) : ''} />
          ))}
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
