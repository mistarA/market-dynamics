export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatPct(
  value: number | null | undefined,
  digits = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function pctClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-IN');
}

export function plural(count: number, singular: string, pluralForm?: string) {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}

/**
 * The snapshot's industry field is `—` for every symbol (NSE never returned
 * one). Treat that placeholder as absent so the UI does not print a lone dash
 * under every stock.
 */
export function cleanIndustry(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '—' || trimmed === '-') return null;
  return trimmed;
}
