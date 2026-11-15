import { averageTrueRange } from './swings';
import type { Bar, MssEvent, Pivot } from './types';

/**
 * Experimental signal-quality gates for the structure chart.
 *
 * The ATR used here is a volatility ruler, not the ATR swing detector: the same
 * thresholds apply to fractal and ATR-zigzag structures, because the question
 * is "is this break big enough relative to normal bar movement", which is
 * independent of how the swing was found.
 */

export type SignalFilters = {
  /**
   * Darvas box: merge nearby overlapping ranges into one consolidation
   * episode and keep only the last MSS in it. Earlier flips inside the same
   * range are chop, not separate calls.
   */
  choppy: boolean;
  /** Require the breaking close to clear the level by >= 0.5 ATR. */
  displacement: boolean;
  /** Reject breaks that are already > 3 ATR beyond the level (late entry). */
  extension: boolean;
};

export const DEFAULT_SIGNAL_FILTERS: SignalFilters = {
  choppy: true,
  displacement: false,
  extension: false,
};

export const DISPLACEMENT_ATR = 0.5;
export const EXTENSION_ATR = 3;

/** A range needs at least two tests of each side to be a box. */
export const DARVAS_SWINGS = 2;
/**
 * Boxes wider than this are a trend, not consolidation. Filtering a breakout
 * against a multi-month range would hide every signal, so wide boxes are left
 * alone.
 */
export const DARVAS_MAX_BOX_ATR = 8;
/**
 * A new box this soon after the previous one ended, and overlapping it this
 * much vertically, is the same consolidation still in progress. Merging them
 * stops a long chop from drawing a stack of near-identical rectangles.
 */
export const DARVAS_MERGE_GAP = 10;
export const DARVAS_MERGE_OVERLAP = 0.5;
/**
 * Upper bound on a merged episode, so two genuine ranges separated by a slow
 * drift are not chained into one months-long box.
 */
export const DARVAS_MERGE_MAX_SPAN = 110;

export type DarvasBox = {
  top: number;
  bottom: number;
  /** Box height in ATR units at the signal bar. */
  widthAtr: number;
  /** Bar index of the earliest pivot in the box. */
  startIdx: number;
  /** Date of the earliest pivot in the box. */
  startDate: string;
};

/**
 * One consolidation episode: adjacent boxes merged into a single range. Only
 * the last MSS inside the episode is a real call; the earlier ones are chop.
 */
export type DarvasEpisode = DarvasBox & {
  /** Bar index of the last MSS in the episode. */
  endIdx: number;
  /** Date of the last MSS in the episode. */
  endDate: string;
  /** Every MSS that fired inside this range, in time order. */
  events: MssEvent[];
};

/**
 * The consolidation box known at `idx`: the full wick range between the last
 * two confirmed swing highs and swing lows. Wicks define the box, so a single
 * spike is included in the range rather than starting a new one.
 *
 * Only pivots confirmed on or before `idx` are used, so the filter never reads
 * a swing the structure engine had not seen yet.
 */
export function darvasBox(
  bars: Bar[],
  pivots: Pivot[],
  idx: number,
  atr: number[],
): DarvasBox | null {
  const a = atr[idx];
  if (!a || a <= 0) return null;

  const highs: Pivot[] = [];
  const lows: Pivot[] = [];
  for (let i = pivots.length - 1; i >= 0; i -= 1) {
    const pivot = pivots[i];
    if (pivot.confirmIdx > idx) continue;
    if (pivot.kind === 'high') {
      if (highs.length < DARVAS_SWINGS) highs.push(pivot);
    } else if (lows.length < DARVAS_SWINGS) {
      lows.push(pivot);
    }
    if (highs.length >= DARVAS_SWINGS && lows.length >= DARVAS_SWINGS) break;
  }

  if (highs.length < DARVAS_SWINGS || lows.length < DARVAS_SWINGS) return null;

  // Wick range of the consolidation: the full high/low envelope between the
  // oldest and newest pivot used.
  const used = [...highs, ...lows];
  const startIdx = Math.min(...used.map((pivot) => pivot.idx));
  const endIdx = Math.max(...used.map((pivot) => pivot.idx));
  let top = -Infinity;
  let bottom = Infinity;
  for (let i = startIdx; i <= endIdx; i += 1) {
    if (bars[i].h > top) top = bars[i].h;
    if (bars[i].l < bottom) bottom = bars[i].l;
  }
  if (top <= bottom) return null;

  return {
    top,
    bottom,
    widthAtr: (top - bottom) / a,
    startIdx,
    startDate: bars[startIdx].d,
  };
}

/**
 * Group the per-event boxes into consolidation episodes. Boxes that overlap in
 * time (or start within a few bars of the previous one) and share most of their
 * vertical range are the same range still being tested, so they merge into one.
 *
 * A signal is only meaningful when it resolves the episode, so the caller keeps
 * the last event of each episode and drops the intermediate ones as chop.
 */
export function darvasEpisodes(
  bars: Bar[],
  events: MssEvent[],
  pivots: Pivot[],
  atr: number[],
): DarvasEpisode[] {
  const episodes: DarvasEpisode[] = [];

  for (const event of events) {
    const box = darvasBox(bars, pivots, event.idx, atr);
    if (!box || box.widthAtr > DARVAS_MAX_BOX_ATR) continue;

    const last = episodes[episodes.length - 1];
    if (last) {
      const timeGap = box.startIdx - last.endIdx;
      const span = Math.max(last.endIdx, event.idx) - Math.min(last.startIdx, box.startIdx);
      const overlap =
        Math.min(box.top, last.top) - Math.max(box.bottom, last.bottom);
      const minHeight = Math.min(box.top - box.bottom, last.top - last.bottom);
      const overlapRatio = overlap > 0 && minHeight > 0 ? overlap / minHeight : 0;

      if (
        timeGap <= DARVAS_MERGE_GAP &&
        overlapRatio >= DARVAS_MERGE_OVERLAP &&
        span <= DARVAS_MERGE_MAX_SPAN
      ) {
        last.top = Math.max(last.top, box.top);
        last.bottom = Math.min(last.bottom, box.bottom);
        if (box.startIdx < last.startIdx) {
          last.startIdx = box.startIdx;
          last.startDate = box.startDate;
        }
        if (event.idx > last.endIdx) {
          last.endIdx = event.idx;
          last.endDate = event.date;
        }
        last.widthAtr = (last.top - last.bottom) / (atr[last.endIdx] || 1);
        last.events.push(event);
        continue;
      }
    }

    episodes.push({
      top: box.top,
      bottom: box.bottom,
      widthAtr: box.widthAtr,
      startIdx: box.startIdx,
      startDate: box.startDate,
      endIdx: event.idx,
      endDate: event.date,
      events: [event],
    });
  }

  return episodes;
}

export function filterSignals(
  bars: Bar[],
  events: MssEvent[],
  pivots: Pivot[],
  filters: SignalFilters,
): { events: MssEvent[]; total: number; kept: number } {
  if (!filters.choppy && !filters.displacement && !filters.extension) {
    return { events, total: events.length, kept: events.length };
  }

  const atr = averageTrueRange(bars);

  // Per-event gates first: how far the breaking close moved past the level.
  const survivors = events.filter((event) => {
    const a = atr[event.idx] ?? null;
    const distance = Math.abs(event.close - event.level);

    if (filters.displacement && a !== null && distance < DISPLACEMENT_ATR * a) {
      return false;
    }
    if (filters.extension && a !== null && distance > EXTENSION_ATR * a) {
      return false;
    }
    return true;
  });

  if (!filters.choppy) {
    return { events: survivors, total: events.length, kept: survivors.length };
  }

  // Darvas: a long consolidation can flip MSS several times. Those flips are
  // chop, so collapse each episode to its last MSS and keep that one call.
  const episodes = darvasEpisodes(bars, survivors, pivots, atr);
  const grouped = new Set<number>();
  const kept: MssEvent[] = [];

  for (const episode of episodes) {
    const last = episode.events[episode.events.length - 1];
    kept.push(last);
    for (const event of episode.events) grouped.add(event.idx);
  }
  // Signals outside any consolidation are trend continuations; keep them.
  for (const event of survivors) {
    if (!grouped.has(event.idx)) kept.push(event);
  }

  kept.sort((left, right) => left.idx - right.idx);
  return { events: kept, total: events.length, kept: kept.length };
}
