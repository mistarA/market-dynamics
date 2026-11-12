import type { Bar, Timeframe } from './types';
import { monthKey, weekKey } from './date';

type Bucket = {
  key: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  date: string;
};

/**
 * Aggregate ascending daily bars into weekly (Monday-based) or monthly bars.
 * The bucket date is the last actual trading date, not a synthetic period end.
 */
export function aggregate(bars: Bar[], timeframe: Timeframe): Bar[] {
  if (timeframe === 'day' || bars.length === 0) return bars;

  const keyOf = timeframe === 'week' ? weekKey : monthKey;
  const out: Bar[] = [];
  let bucket: Bucket | null = null;

  const flush = () => {
    if (!bucket) return;
    out.push({
      d: bucket.date,
      o: bucket.open,
      h: bucket.high,
      l: bucket.low,
      c: bucket.close,
      v: bucket.volume,
    });
  };

  for (const bar of bars) {
    const key = keyOf(bar.d);
    if (!bucket || bucket.key !== key) {
      flush();
      bucket = {
        key,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
        date: bar.d,
      };
    } else {
      bucket.high = Math.max(bucket.high, bar.h);
      bucket.low = Math.min(bucket.low, bar.l);
      bucket.close = bar.c;
      bucket.volume += bar.v;
      bucket.date = bar.d;
    }
  }
  flush();
  return out;
}
