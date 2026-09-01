export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit] ?? 'PB'}`;
}

export function formatRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';

  const elapsed = now - new Date(iso).getTime();
  if (Number.isNaN(elapsed)) return 'unknown';
  if (elapsed < 5_000) return 'just now';

  const steps: ReadonlyArray<[number, string]> = [
    [60_000, 'second'],
    [3_600_000, 'minute'],
    [86_400_000, 'hour'],
    [Number.POSITIVE_INFINITY, 'day'],
  ];
  const divisors = [1000, 60_000, 3_600_000, 86_400_000];

  for (const [index, [limit, unit]] of steps.entries()) {
    if (elapsed < limit) {
      const amount = Math.floor(elapsed / (divisors[index] ?? 1000));
      return `${amount} ${unit}${amount === 1 ? '' : 's'} ago`;
    }
  }

  return 'a long time ago';
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "Radarr-4K" -> "R4" - two-character column badges for the matrix headers. */
export function initialsOf(name: string): string {
  const parts = name
    .split(/[\s\-_/]+/)
    .filter((part) => part.length > 0)
    .slice(0, 2);

  if (parts.length === 0) return '??';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return parts.map((part) => (part[0] ?? '').toUpperCase()).join('');
}
