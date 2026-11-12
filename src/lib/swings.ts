import type { Bar, Pivot } from './types';

export type SwingLabel = 'HH' | 'HL' | 'LH' | 'LL';

export type LabeledPivot = Pivot & {
  label: SwingLabel | null;
  /** External trend after this pivot's own HH/LL update. */
  trendAtFormation: -1 | 0 | 1;
};

export const ATR_PERIOD = 14;
export const EXTERNAL_ATR_MULTIPLE = 2;

/** Wilder's ATR, seeded with a simple average so the first bars are usable. */
export function averageTrueRange(
  bars: Bar[],
  period = ATR_PERIOD,
): number[] {
  const ranges = bars.map((bar, index) => {
    if (index === 0) return bar.h - bar.l;
    const previous = bars[index - 1].c;
    return Math.max(
      bar.h - bar.l,
      Math.abs(bar.h - previous),
      Math.abs(bar.l - previous),
    );
  });

  const atr: number[] = new Array(bars.length).fill(0);
  let sum = 0;

  for (let i = 0; i < bars.length; i += 1) {
    if (i < period) {
      sum += ranges[i];
      atr[i] = sum / (i + 1);
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + ranges[i]) / period;
    }
  }

  return atr;
}

/**
 * Volatility zigzag. A swing is only confirmed after price reverses by
 * `multiple × ATR`, so the threshold scales with the symbol and timeframe
 * instead of relying on a fixed bar count or price amount.
 */
export function findZigzagPivots(
  bars: Bar[],
  multiple = EXTERNAL_ATR_MULTIPLE,
  period = ATR_PERIOD,
): Pivot[] {
  if (bars.length < 3) return [];

  const atr = averageTrueRange(bars, period);
  const pivots: Pivot[] = [];

  let direction: -1 | 0 | 1 = 0;
  let high = bars[0].h;
  let highIdx = 0;
  let low = bars[0].l;
  let lowIdx = 0;

  for (let i = 1; i < bars.length; i += 1) {
    const bar = bars[i];
    const threshold = atr[i] * multiple;

    if (direction >= 0) {
      if (bar.h > high) {
        high = bar.h;
        highIdx = i;
      }
      if (high - bar.l >= threshold && highIdx < i) {
        pivots.push({
          idx: highIdx,
          date: bars[highIdx].d,
          price: high,
          kind: 'high',
          confirmIdx: i,
        });
        direction = -1;
        low = bar.l;
        lowIdx = i;
        continue;
      }
    }

    if (direction <= 0) {
      if (bar.l < low) {
        low = bar.l;
        lowIdx = i;
      }
      if (bar.h - low >= threshold && lowIdx < i) {
        pivots.push({
          idx: lowIdx,
          date: bars[lowIdx].d,
          price: low,
          kind: 'low',
          confirmIdx: i,
        });
        direction = 1;
        high = bar.h;
        highIdx = i;
      }
    }
  }

  return pivots;
}

/** Compare each swing with the previous swing of the same kind. */
export function labelSwings(pivots: Pivot[]): LabeledPivot[] {
  const labeled: LabeledPivot[] = [];

  let previousHigh: Pivot | null = null;
  let previousLow: Pivot | null = null;
  let trend: -1 | 0 | 1 = 0;

  for (const pivot of pivots) {
    if (pivot.kind === 'high') {
      const label: SwingLabel | null = previousHigh
        ? pivot.price > previousHigh.price
          ? 'HH'
          : 'LH'
        : null;

      if (label === 'HH') trend = 1;
      labeled.push({ ...pivot, label, trendAtFormation: trend });
      previousHigh = pivot;
    } else {
      const label: SwingLabel | null = previousLow
        ? pivot.price > previousLow.price
          ? 'HL'
          : 'LL'
        : null;

      if (label === 'LL') trend = -1;
      labeled.push({ ...pivot, label, trendAtFormation: trend });
      previousLow = pivot;
    }
  }

  return labeled;
}

/**
 * The external staircase: every ATR-zigzag pivot, labelled against the
 * previous swing of the same kind. The zigzag already alternates high/low, so
 * the staircase stays coherent and the labels always match the visible
 * neighbours.
 */
export function findExternalMarkers(pivots: Pivot[]): LabeledPivot[] {
  return labelSwings(pivots).filter((pivot) => pivot.label !== null);
}

/**
 * Optional decluttering: keep only swings that agree with the trend at the
 * time they formed, in strict high/low alternation.
 *
 * Dropping a counter-trend pivot (for example the lower high inside a bull
 * leg) would otherwise leave two markers of the same kind next to each other.
 * In that case the more extreme pivot wins - the highest high, the lowest low.
 *
 * Note: labels are still computed against the full zigzag, so a displayed
 * swing can be labelled relative to a pivot that is hidden. Prefer the full
 * staircase unless that trade-off is acceptable.
 */
export function findTrendAlignedMarkers(pivots: Pivot[]): LabeledPivot[] {
  const kept: LabeledPivot[] = [];

  for (const pivot of labelSwings(pivots)) {
    if (!pivot.label) continue;

    const aligned =
      pivot.trendAtFormation === 1
        ? pivot.label === 'HH' || pivot.label === 'HL'
        : pivot.trendAtFormation === -1
          ? pivot.label === 'LH' || pivot.label === 'LL'
          : true;
    if (!aligned) continue;

    const last = kept[kept.length - 1];
    if (last && last.kind === pivot.kind) {
      const moreExtreme =
        pivot.kind === 'high'
          ? pivot.price >= last.price
          : pivot.price <= last.price;
      if (moreExtreme) kept[kept.length - 1] = pivot;
      continue;
    }

    kept.push(pivot);
  }

  return kept;
}
