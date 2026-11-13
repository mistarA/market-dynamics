import { findPivots } from './pivots';
import type {
  Bar,
  Confirmation,
  MssEvent,
  Pivot,
  Structure,
} from './types';

export type StructureOptions = {
  k?: number;
  confirmation?: Confirmation;
  /** Exclude the final bar (an uncompleted live bar) from detection. */
  dropLast?: boolean;
  /**
   * Override the pivot detector. This lets the same state machine run on
   * fractal pivots for the live dashboard and on ATR zigzag pivots for the
   * backtest, without duplicating the structure logic.
   */
  pivots?: Pivot[];
};

/**
 * Market structure state machine.
 *
 * - Track the latest confirmed swing high and swing low.
 * - A close beyond the latest opposing swing flips structure and clears that
 *   side; new pivots repopulate it.
 * - Confirmation 1 uses the close of the breaking bar. Confirmation 2 requires
 *   two consecutive closes beyond a level that was already known.
 */
export function computeStructure(
  bars: Bar[],
  options: StructureOptions = {},
): Structure {
  const k = options.k ?? 2;
  const confirmation = options.confirmation ?? 1;
  const allBars = bars;
  const detectionBars =
    options.dropLast && allBars.length > 0 ? allBars.slice(0, -1) : allBars;
  const pivots = options.pivots ?? findPivots(detectionBars, k);
  const events: MssEvent[] = [];

  let lastHigh: Pivot | null = null;
  let lastLow: Pivot | null = null;
  let trend: Structure['trend'] = 0;
  let pointer = 0;

  for (let t = 0; t < detectionBars.length; t += 1) {
    while (pointer < pivots.length && pivots[pointer].confirmIdx <= t) {
      const pivot = pivots[pointer];
      pointer += 1;
      if (pivot.kind === 'high') lastHigh = pivot;
      else lastLow = pivot;
    }

    const bar = detectionBars[t];

    if (trend !== 1 && lastHigh && bar.c > lastHigh.price) {
      const level = lastHigh.price;
      const confirmed =
        confirmation === 1 ||
        (t >= 1 &&
          detectionBars[t - 1].c > level &&
          lastHigh.confirmIdx <= t - 1);
      if (confirmed) {
        events.push({
          idx: t,
          date: bar.d,
          direction: 'bullish',
          level,
          close: bar.c,
          breakoutPct: (bar.c / level - 1) * 100,
          stopLevel: lastLow ? lastLow.price : null,
          stopIdx: lastLow ? lastLow.idx : null,
          stopDate: lastLow ? lastLow.date : null,
        });
        trend = 1;
        lastHigh = null;
        continue;
      }
    }

    if (trend !== -1 && lastLow && bar.c < lastLow.price) {
      const level = lastLow.price;
      const confirmed =
        confirmation === 1 ||
        (t >= 1 &&
          detectionBars[t - 1].c < level &&
          lastLow.confirmIdx <= t - 1);
      if (confirmed) {
        events.push({
          idx: t,
          date: bar.d,
          direction: 'bearish',
          level,
          close: bar.c,
          breakoutPct: (bar.c / level - 1) * 100,
          stopLevel: lastHigh ? lastHigh.price : null,
          stopIdx: lastHigh ? lastHigh.idx : null,
          stopDate: lastHigh ? lastHigh.date : null,
        });
        trend = -1;
        lastLow = null;
      }
    }
  }

  const lastEvent = events.length ? events[events.length - 1] : null;
  const barsSince = lastEvent ? allBars.length - 1 - lastEvent.idx : null;

  return {
    allBars,
    detectionBars,
    events,
    pivots,
    trend,
    activeHigh: lastHigh ? lastHigh.price : null,
    activeLow: lastLow ? lastLow.price : null,
    lastEvent,
    barsSince,
  };
}
