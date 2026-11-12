import type { MarketState, Timeframe } from './types';

const IST_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function istMarketState(now = new Date()): MarketState {
  const parts = IST_FORMAT.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const today = `${get('year')}-${get('month')}-${get('day')}`;
  const weekday = get('weekday');
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const minutes = hour * 60 + minute;
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  const open = isWeekday && minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
  return {
    today,
    open,
    label: open ? 'Market open' : 'Market closed',
  };
}

export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function daysBetween(a: string, b: string): number {
  return Math.round(
    (parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000,
  );
}

/** Monday-based week key, e.g. 2026-W46. */
export function weekKey(value: string): string {
  const date = parseDate(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function monthKey(value: string): string {
  return value.slice(0, 7);
}

export function sameWeek(a: string, b: string): boolean {
  return weekKey(a) === weekKey(b);
}

export function sameMonth(a: string, b: string): boolean {
  return monthKey(a) === monthKey(b);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return parseDate(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateShort(value: string | null | undefined): string {
  if (!value) return '—';
  return parseDate(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function barsAgoLabel(value: number | null): string {
  if (value === null || value === undefined) return 'No shift';
  if (value <= 0) return 'This bar';
  if (value === 1) return '1 bar ago';
  return `${value} bars ago`;
}

export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
};

export const TIMEFRAME_SHORT: Record<Timeframe, string> = {
  day: 'D',
  week: 'W',
  month: 'M',
};
