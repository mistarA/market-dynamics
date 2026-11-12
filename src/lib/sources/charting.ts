import type { Bar, ResolvedSymbol } from '../types';
import { nseJson } from './nse';

/**
 * NSE charting API adapter (server-side only).
 *
 * Two-step flow:
 *   1. /v1/exchanges/symbolsDynamic?symbol=RELIANCE-EQ  -> scripcode
 *   2. /v1/charts/symbolHistoricalData?token=<scripcode> -> OHLCV
 *
 * The `token` is the scripcode, and the `symbol` query param on the history
 * endpoint is ignored. See `nse.ts` for the CORS/header rules.
 */

const BASE = 'https://charting.nseindia.com/v1';

type LookupRow = {
  symbol: string;
  scripcode: string;
  type: string;
  description?: string;
};

type HistoryRow = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ChartingOptions = {
  timeoutMs?: number;
  retries?: number;
};

/** Resolve a ticker (RELIANCE) or index name (NIFTY 50) to an NSE scripcode. */
export async function resolveSymbol(
  ticker: string,
  options: ChartingOptions & { type?: 'Equity' | 'Index' } = {},
): Promise<ResolvedSymbol> {
  const wantType = options.type ?? 'Equity';
  const query = wantType === 'Equity' ? `${ticker}-EQ` : ticker;
  const url = new URL(`${BASE}/exchanges/symbolsDynamic`);
  url.searchParams.set('symbol', query);

  const payload = await nseJson<{ status: boolean; data?: LookupRow[] }>(url, {
    timeoutMs: options.timeoutMs,
    retries: options.retries,
  });

  const rows = payload.data ?? [];
  const exact = rows.find(
    (row) =>
      row.symbol.toUpperCase() === query.toUpperCase() &&
      row.type === wantType,
  );
  const fallback = exact ?? rows.find((row) => row.type === wantType);

  if (!fallback || !fallback.scripcode) {
    throw new Error(`No NSE ${wantType} match for ${query}`);
  }

  return {
    ticker,
    symbol: fallback.symbol,
    scripcode: String(fallback.scripcode),
    type: wantType,
    description: fallback.description ?? fallback.symbol,
  };
}

function toBar(row: HistoryRow): Bar | null {
  if (
    !row ||
    !Number.isFinite(row.time) ||
    !Number.isFinite(row.open) ||
    !Number.isFinite(row.high) ||
    !Number.isFinite(row.low) ||
    !Number.isFinite(row.close)
  ) {
    return null;
  }
  if (row.open <= 0 || row.high <= 0 || row.low <= 0 || row.close <= 0) {
    return null;
  }
  const date = new Date(row.time).toISOString().slice(0, 10);
  const volume = Number.isFinite(row.volume) ? row.volume : 0;
  const high = Math.max(row.high, row.open, row.close);
  const low = Math.min(row.low, row.open, row.close);
  return {
    d: date,
    o: round2(row.open),
    h: round2(high),
    l: round2(low),
    c: round2(row.close),
    v: Math.round(volume),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Fetch daily bars between two ISO dates (inclusive).
 * `fromDate`/`toDate` are unix seconds; the response `time` is milliseconds.
 */
export async function fetchDaily(
  resolved: ResolvedSymbol,
  fromDate: string,
  toDate: string,
  options: ChartingOptions = {},
): Promise<Bar[]> {
  const fromSec = Math.floor(Date.parse(`${fromDate}T00:00:00Z`) / 1000);
  const toSec = Math.floor(Date.parse(`${toDate}T23:59:59Z`) / 1000);

  const url = new URL(`${BASE}/charts/symbolHistoricalData`);
  url.searchParams.set('token', resolved.scripcode);
  url.searchParams.set('fromDate', String(fromSec));
  url.searchParams.set('toDate', String(toSec));
  url.searchParams.set('symbol', resolved.symbol);
  url.searchParams.set('symbolType', resolved.type);
  url.searchParams.set('chartType', 'D');
  url.searchParams.set('timeInterval', '1');

  const payload = await nseJson<{ status: boolean; data?: HistoryRow[] }>(url, {
    timeoutMs: options.timeoutMs,
    retries: options.retries,
  });

  const raw = payload.data ?? [];
  const byDate = new Map<string, Bar>();
  for (const row of raw) {
    const bar = toBar(row);
    if (!bar) continue;
    byDate.set(bar.d, bar);
  }

  return [...byDate.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
}

/** Convenience: last close and last date from a series. */
export function lastBarInfo(bars: Bar[]): {
  lastDate: string;
  lastClose: number;
  barCount: number;
} | null {
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  return { lastDate: last.d, lastClose: last.c, barCount: bars.length };
}
