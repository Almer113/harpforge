// Which of a tab's old versions to keep: every save from the last day, then one a day for a
// month, then one a week. The newest and the ones you named are always kept.

export interface Kept {
  id: string;
  at: number;
  name?: string;
}

const DAY = 24 * 3600 * 1000;

/** The local calendar day of a time ("2026-10-16"). */
function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** The local week of a time (its Monday's day). */
function weekKey(t: number): string {
  const d = new Date(t);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d.getTime());
}

/** The versions thinning drops (their ids). */
export function versionsToDrop(versions: Kept[], now = Date.now()): string[] {
  const newestFirst = [...versions].sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const drop: string[] = [];
  newestFirst.forEach((v, i) => {
    if (i === 0 || v.name || now - v.at < DAY) return;
    // (The newest of each day, or week, is the one kept: it's the day's last word.)
    const key = now - v.at < 30 * DAY ? `d${dayKey(v.at)}` : `w${weekKey(v.at)}`;
    if (seen.has(key)) drop.push(v.id);
    else seen.add(key);
  });
  return drop;
}
