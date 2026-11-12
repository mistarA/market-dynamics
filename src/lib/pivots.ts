import type { Bar, Pivot } from './types';

/**
 * Strict fractal pivots. A pivot at index i is only confirmed k bars later
 * (confirmIdx = i + k), which prevents look-ahead in the MSS engine.
 */
export function findPivots(bars: Bar[], k = 2): Pivot[] {
  const n = bars.length;
  if (n < 2 * k + 1) return [];
  const pivots: Pivot[] = [];

  for (let i = k; i < n - k; i += 1) {
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= k; j += 1) {
      if (bars[i].h <= bars[i - j].h || bars[i].h <= bars[i + j].h) isHigh = false;
      if (bars[i].l >= bars[i - j].l || bars[i].l >= bars[i + j].l) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) {
      pivots.push({
        idx: i,
        date: bars[i].d,
        price: bars[i].h,
        kind: 'high',
        confirmIdx: i + k,
      });
    }
    if (isLow) {
      pivots.push({
        idx: i,
        date: bars[i].d,
        price: bars[i].l,
        kind: 'low',
        confirmIdx: i + k,
      });
    }
  }

  return pivots.sort(
    (a, b) => a.confirmIdx - b.confirmIdx || a.idx - b.idx,
  );
}

