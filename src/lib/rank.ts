import { aggregate } from './aggregate';
import { computeStructure } from './mss';
import type {
  AnalysisContext,
  Bar,
  BarTuple,
  Confirmation,
  Detail,
  Direction,
  Row,
  RowStatus,
  SnapshotSymbol,
  Timeframe,
} from './types';

/** Below this many bars in the selected timeframe a ranking is meaningless. */
export const MIN_BARS = 30;

const SPARK_POINTS: Record<Timeframe, number> = {
  day: 40,
  week: 26,
  month: 12,
};

export function tuplesToBars(tuples: BarTuple[]): Bar[] {
  return tuples.map(([d, o, h, l, c, v]) => ({ d, o, h, l, c, v }));
}

export type Analysis = {
  row: Row;
  detail: Detail;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * One pass per symbol: aggregate, detect structure over the full history, then
 * build the table row and the drawer detail from the same series.
 */
export function analyse(
  symbol: string,
  meta: SnapshotSymbol,
  timeframe: Timeframe,
  confirmation: Confirmation,
  context: AnalysisContext,
  dailyBars?: Bar[],
): Analysis {
  const daily = dailyBars ?? tuplesToBars(meta.bars);
  const bars = aggregate(daily, timeframe);
  const structure = computeStructure(bars, {
    confirmation,
    dropLast: context.provisional,
  });

  const last = bars.length ? bars[bars.length - 1] : null;
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const close = last?.c ?? 0;
  const changePct = last && prev ? round((close / prev.c - 1) * 100) : null;
  const event = structure.lastEvent;
  const barsSince = structure.barsSince;
  const sincePct =
    event && event.close > 0 ? round((close / event.close - 1) * 100) : null;
  const lastDate = last?.d ?? '';
  const status: RowStatus =
    bars.length < MIN_BARS
      ? 'insufficient'
      : lastDate < context.asOf
        ? 'stale'
        : 'ok';
  const spark = bars
    .slice(-SPARK_POINTS[timeframe])
    .map((bar) => round(bar.c, 2));

  const row: Row = {
    symbol,
    name: meta.name,
    industry: meta.industry,
    close: round(close, 2),
    changePct,
    direction: event?.direction ?? null,
    barsSince,
    eventDate: event?.date ?? null,
    eventClose: event ? round(event.close, 2) : null,
    level: event ? round(event.level, 2) : null,
    breakoutPct: event ? round(event.breakoutPct, 2) : null,
    sincePct,
    trend: structure.trend,
    activeHigh: structure.activeHigh,
    activeLow: structure.activeLow,
    spark,
    barCount: bars.length,
    lastDate,
    provisional: context.provisional && lastDate === context.today,
    status,
  };

  const detail: Detail = {
    symbol,
    name: meta.name,
    industry: meta.industry,
    timeframe,
    confirmation,
    bars,
    events: structure.events,
    pivots: structure.pivots,
    activeHigh: structure.activeHigh,
    activeLow: structure.activeLow,
    lastEvent: event,
    barsSince,
    close: round(close, 2),
    changePct,
    provisional: row.provisional,
  };

  return { row, detail };
}

export type SortKey = 'recent' | 'symbol' | 'change' | 'since' | 'close';

export function sortRows(rows: Row[], key: SortKey, direction: 'asc' | 'desc'): Row[] {
  const factor = direction === 'asc' ? 1 : -1;
  const copy = [...rows];

  copy.sort((a, b) => {
    if (key === 'symbol') return a.symbol.localeCompare(b.symbol) * factor;
    if (key === 'recent') {
      // Symbols without a confirmed shift always stay at the bottom.
      const aMissing = a.status === 'insufficient' || a.barsSince === null;
      const bMissing = b.status === 'insufficient' || b.barsSince === null;
      if (aMissing && bMissing) return a.symbol.localeCompare(b.symbol);
      if (aMissing) return 1;
      if (bMissing) return -1;
      return (
        ((a.barsSince as number) - (b.barsSince as number)) * factor ||
        a.symbol.localeCompare(b.symbol)
      );
    }
    const field =
      key === 'change' ? 'changePct' : key === 'since' ? 'sincePct' : 'close';
    const aValue = a[field] ?? (factor === 1 ? Infinity : -Infinity);
    const bValue = b[field] ?? (factor === 1 ? Infinity : -Infinity);
    return (aValue - bValue) * factor || a.symbol.localeCompare(b.symbol);
  });

  return copy;
}

export function filterRows(
  rows: Row[],
  options: { direction?: Direction | 'all'; query?: string },
): Row[] {
  const query = (options.query ?? '').trim().toUpperCase();
  const direction = options.direction ?? 'all';

  return rows.filter((row) => {
    if (direction !== 'all' && row.direction !== direction) return false;
    if (!query) return true;
    return (
      row.symbol.includes(query) ||
      row.name.toUpperCase().includes(query) ||
      row.industry.toUpperCase().includes(query)
    );
  });
}

export function summarise(rows: Row[]): {
  bullish: number;
  bearish: number;
  fresh: number;
  medianBars: number | null;
} {
  let bullish = 0;
  let bearish = 0;
  let fresh = 0;
  const ages: number[] = [];

  for (const row of rows) {
    if (row.direction === 'bullish') bullish += 1;
    if (row.direction === 'bearish') bearish += 1;
    if (row.barsSince !== null) {
      ages.push(row.barsSince);
      if (row.barsSince <= 5) fresh += 1;
    }
  }

  ages.sort((a, b) => a - b);
  const medianBars = ages.length
    ? ages[Math.floor(ages.length / 2)]
    : null;

  return { bullish, bearish, fresh, medianBars };
}
