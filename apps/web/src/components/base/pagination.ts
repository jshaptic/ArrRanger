/**
 * A compact page window: every page when there are few, otherwise the ends plus the
 * neighbours of the current one, with a gap where numbers were skipped.
 *
 * `1 … 4 5 6 … 12` is the shape. Seven or fewer is just the run, because a gap in a
 * short list is a hole rather than a compression.
 */
export function pageItems(current: number, total: number): Array<number | 'gap'> {
  if (total < 1) return [];
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const picks = new Set<number>([1, total, current]);
  if (current - 1 > 1) picks.add(current - 1);
  if (current + 1 < total) picks.add(current + 1);
  if (current <= 3) {
    picks.add(2);
    picks.add(3);
    picks.add(4);
  }
  if (current >= total - 2) {
    picks.add(total - 3);
    picks.add(total - 2);
    picks.add(total - 1);
  }

  const sorted = [...picks].filter((n) => n >= 1 && n <= total).sort((left, right) => left - right);
  const items: Array<number | 'gap'> = [];
  for (const n of sorted) {
    const last = items.at(-1);
    if (typeof last === 'number' && n - last > 1) items.push('gap');
    items.push(n);
  }
  return items;
}
