// Two texts compared line by line: which lines are the same, which were added, which removed
// (the longest run of lines they share kept as "same").

export interface DiffLine {
  op: 'same' | 'add' | 'del';
  text: string;
}

/** Past this many cells the comparison gives up on finding shared lines in the middle. */
const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  // (A final newline isn't a line.)
  if (a[a.length - 1] === '' && b[b.length - 1] === '') {
    a.pop();
    b.pop();
  }
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).map((text): DiffLine => ({ op: 'same', text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ op: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  return [...head, ...middle(midA, midB), ...tail];
}

function middle(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  if (!n || !m || n * m > MAX_CELLS) return [...a.map((text): DiffLine => ({ op: 'del', text })), ...b.map((text): DiffLine => ({ op: 'add', text }))];
  // lcs[i][j]: the most lines a[i..] and b[j..] share, in order.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i++] });
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) out.push({ op: 'del', text: a[i++] });
    else out.push({ op: 'add', text: b[j++] });
  }
  while (i < n) out.push({ op: 'del', text: a[i++] });
  while (j < m) out.push({ op: 'add', text: b[j++] });
  return out;
}

/** How many lines were added and removed. */
export function diffCounts(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.op === 'add') added++;
    else if (l.op === 'del') removed++;
  }
  return { added, removed };
}

/** "3 lines added, 1 removed" ("No changes" when there are none). */
export function describeChange(before: string, after: string): string {
  const { added, removed } = diffCounts(diffLines(before, after));
  const lines = (k: number) => `${k} line${k === 1 ? '' : 's'}`;
  if (added && removed) return `${lines(added)} added, ${removed} removed`;
  if (added) return `${lines(added)} added`;
  if (removed) return `${lines(removed)} removed`;
  return 'No changes';
}
