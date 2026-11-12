import { computeStructure } from './mss';
import { findPivots } from './pivots';
import { findZigzagPivots } from './swings';
import type {
  Bar,
  BacktestEquityPoint,
  BacktestScope,
  BacktestScopeKey,
  BacktestSetupResult,
  BacktestStats,
  BacktestTrade,
  Confirmation,
  MssEvent,
  SnapshotIndex,
  SwingMethod,
} from './types';

/** Demergers in the raw NSE series create fake flips, stops and targets. */
export const EXCLUDED_SYMBOLS = new Set(['SIEMENS', 'TMPV', 'VEDL']);

/** Target distance as a multiple of the entry-to-stop risk. */
export const TARGET_R = 2;

/** With a 2R target, a 1R stop needs 33.3% wins to break even. */
export const BREAKEVEN_WIN_RATE = 1 / (1 + TARGET_R);

/** A close-to-close move this large is treated as a data warning. */
const CORPORATE_ACTION_GAP = 0.25;

export type BacktestConfig = {
  method: SwingMethod;
  confirmation?: Confirmation;
  /** Round-trip cost applied per side, in basis points. */
  costsBps?: number;
  atrMultiple?: number;
  atrPeriod?: number;
  /** Trim today's still-forming bar before detection. */
  dropLast?: boolean;
};

export type SymbolRun = {
  trades: BacktestTrade[];
  skipped: number;
};

export type ScopeInput = {
  key: BacktestScopeKey;
  label: string;
  symbols: string[];
  barsFor: (symbol: string) => Bar[];
};

function pivotsFor(bars: Bar[], config: BacktestConfig) {
  if (config.method === 'fractal') return findPivots(bars, 2);
  return findZigzagPivots(
    bars,
    config.atrMultiple ?? 2,
    config.atrPeriod ?? 14,
  );
}

function netR(trade: BacktestTrade, exit: number, costsBps: number): number {
  const gross =
    trade.direction === 'bullish'
      ? (exit - trade.entry) / trade.risk
      : (trade.entry - exit) / trade.risk;
  // Costs are charged on entry and exit, expressed in R so they can be
  // compared directly with the target and stop distances.
  const costR =
    ((2 * Math.max(costsBps, 0)) / 10_000) * (trade.entry / trade.risk);
  return gross - costR;
}

/**
 * Simulate one symbol.
 *
 * - Entry: next bar's open after a confirmed MSS flip.
 * - Stop: the opposite swing known at the flip, frozen at entry.
 * - Target: `TARGET_R` from the actual entry open.
 * - Intrabar: target hit when the high/low reaches the level; stop hit when
 *   the forward bar reaches the level. The entry bar is included.
 * - Same bar touches stop and target: marked ambiguous and excluded from W/L.
 * - Exit on the next flip at that bar's open, then reverse at the same open.
 * - An open already beyond the stop, or a flip with no active opposite swing,
 *   is skipped and counted.
 * - A still-open position at the end is reported as open.
 */
export function runSetup(
  symbol: string,
  bars: Bar[],
  config: BacktestConfig,
): SymbolRun {
  const series =
    config.dropLast && bars.length > 1 ? bars.slice(0, -1) : bars;
  if (series.length < 3) return { trades: [], skipped: 0 };

  const structure = computeStructure(series, {
    confirmation: config.confirmation ?? 1,
    pivots: pivotsFor(series, config),
  });

  const eventAt = new Map<number, MssEvent>();
  for (const event of structure.events) eventAt.set(event.idx, event);

  const costsBps = config.costsBps ?? 0;
  const trades: BacktestTrade[] = [];
  let position: BacktestTrade | null = null;
  let pending: MssEvent | null = null;
  let skipped = 0;

  const closeTrade = (
    trade: BacktestTrade,
    idx: number,
    price: number | null,
    reason: BacktestTrade['exitReason'],
  ) => {
    trade.exitIdx = idx;
    trade.exitDate = series[idx].d;
    trade.exit = price;
    trade.exitReason = reason;
    trade.barsHeld = idx - trade.entryIdx;
    trade.r = price === null ? null : netR(trade, price, costsBps);
    if (price !== null) {
      const gross =
        trade.direction === 'bullish'
          ? (price - trade.entry) / trade.risk
          : (trade.entry - price) / trade.risk;
      trade.mfeR = Math.max(trade.mfeR, gross);
      trade.maeR = Math.min(trade.maeR, gross);
    }
  };

  for (let t = 0; t < series.length; t += 1) {
    const bar = series[t];

    if (pending) {
      const flip = pending;
      pending = null;

      if (position) {
        closeTrade(position, t, bar.o, 'flip');
        position = null;
      }

      const stop = flip.stopLevel;
      const bullish = flip.direction === 'bullish';
      const entry = bar.o;
      const valid =
        stop !== null &&
        Number.isFinite(stop) &&
        (bullish ? entry > stop : entry < stop);

      if (valid) {
        const risk = bullish ? entry - stop : stop - entry;
        const target = bullish
          ? entry + TARGET_R * risk
          : entry - TARGET_R * risk;
        position = {
          symbol,
          direction: flip.direction,
          signalDate: flip.date,
          signalLevel: flip.level,
          entryIdx: t,
          entryDate: bar.d,
          entry,
          stop,
          target,
          risk,
          riskPct: risk > 0 ? (risk / entry) * 100 : 0,
          exitIdx: null,
          exitDate: null,
          exit: null,
          exitReason: 'open',
          barsHeld: null,
          r: null,
          mfeR: 0,
          maeR: 0,
        };
        trades.push(position);
      } else {
        skipped += 1;
      }
    }

    if (position) {
      const bullish = position.direction === 'bullish';
      const hitStop = bullish
        ? bar.l <= position.stop
        : bar.h >= position.stop;
      const hitTarget = bullish
        ? bar.h >= position.target
        : bar.l <= position.target;

      // Excursions are only measured on bars where neither level resolves the
      // trade. On a resolving bar the intrabar order is unknowable, so the
      // outcome itself is the best evidence of how far the trade ran.
      if (!hitStop && !hitTarget) {
        const favorable = bullish
          ? (bar.h - position.entry) / position.risk
          : (position.entry - bar.l) / position.risk;
        const adverse = bullish
          ? (bar.l - position.entry) / position.risk
          : (position.entry - bar.h) / position.risk;
        position.mfeR = Math.max(position.mfeR, favorable);
        position.maeR = Math.min(position.maeR, adverse);
      }

      if (hitStop && hitTarget) {
        closeTrade(position, t, null, 'ambiguous');
        position.mfeR = Math.max(position.mfeR, TARGET_R);
        position.maeR = Math.min(position.maeR, -1);
        position = null;
      } else if (hitStop) {
        closeTrade(position, t, position.stop, 'stop');
        position = null;
      } else if (hitTarget) {
        closeTrade(position, t, position.target, 'target');
        position = null;
      }
    }

    const event = eventAt.get(t);
    if (event) pending = event;
  }

  if (position) {
    const last = series.length - 1;
    closeTrade(position, last, null, 'open');
  }

  return { trades, skipped };
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarise(
  trades: BacktestTrade[],
  skipped = 0,
): BacktestStats {
  const resolved = trades.filter(
    (trade) =>
      trade.r !== null &&
      (trade.exitReason === 'target' ||
        trade.exitReason === 'stop' ||
        trade.exitReason === 'flip'),
  );
  const ambiguous = trades.filter(
    (trade) => trade.exitReason === 'ambiguous',
  ).length;
  const open = trades.filter((trade) => trade.exitReason === 'open').length;

  const wins = resolved.filter((trade) => (trade.r as number) > 0);
  const losses = resolved.filter((trade) => (trade.r as number) < 0);
  const scratches = resolved.filter((trade) => trade.r === 0);

  const decided = wins.length + losses.length;
  const withAmbiguous = decided + ambiguous;
  const totalR = resolved.reduce((sum, trade) => sum + (trade.r as number), 0);
  const gainR = wins.reduce((sum, trade) => sum + (trade.r as number), 0);
  const lossR = losses.reduce((sum, trade) => sum + (trade.r as number), 0);

  const ordered = [...resolved].sort((a, b) => {
    const dateA = a.exitDate ?? '';
    const dateB = b.exitDate ?? '';
    return dateA.localeCompare(dateB) || a.symbol.localeCompare(b.symbol);
  });
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of ordered) {
    equity += trade.r as number;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    scratches: scratches.length,
    ambiguous,
    open,
    skipped,
    targetHits: trades.filter((trade) => trade.exitReason === 'target').length,
    stopHits: trades.filter((trade) => trade.exitReason === 'stop').length,
    flipExits: trades.filter((trade) => trade.exitReason === 'flip').length,
    winRate: decided ? wins.length / decided : null,
    winRateLower: withAmbiguous ? wins.length / withAmbiguous : null,
    winRateUpper: withAmbiguous
      ? (wins.length + ambiguous) / withAmbiguous
      : null,
    avgWinR: average(wins.map((trade) => trade.r as number)),
    avgLossR: average(losses.map((trade) => trade.r as number)),
    expectancyR: resolved.length ? totalR / resolved.length : null,
    profitFactor: lossR < 0 ? gainR / Math.abs(lossR) : null,
    totalR,
    maxDrawdownR: maxDrawdown,
    avgRiskPct: average(trades.map((trade) => trade.riskPct)),
    avgBarsHeld: average(
      ordered
        .map((trade) => trade.barsHeld)
        .filter((value): value is number => value !== null),
    ),
    avgMfeR: average(resolved.map((trade) => trade.mfeR)),
    avgMaeR: average(resolved.map((trade) => trade.maeR)),
    lossesUnderHalfR: losses.filter((trade) => trade.mfeR < 0.5).length,
    winsAfterHalfR: wins.filter((trade) => trade.maeR <= -0.5).length,
  };
}

export function equityFromTrades(trades: BacktestTrade[]): BacktestEquityPoint[] {
  const resolved = trades
    .filter(
      (trade) =>
        trade.r !== null &&
        (trade.exitReason === 'target' ||
          trade.exitReason === 'stop' ||
          trade.exitReason === 'flip'),
    )
    .sort((a, b) => {
      const dateA = a.exitDate ?? '';
      const dateB = b.exitDate ?? '';
      return dateA.localeCompare(dateB) || a.symbol.localeCompare(b.symbol);
    });

  if (!resolved.length) return [];

  const points: BacktestEquityPoint[] = [
    { d: resolved[0].entryDate, r: 0 },
  ];
  let cumulative = 0;
  for (const trade of resolved) {
    cumulative += trade.r as number;
    points.push({ d: trade.exitDate ?? trade.entryDate, r: cumulative });
  }
  return points;
}

function setupResult(
  method: SwingMethod,
  trades: BacktestTrade[],
  skipped: number,
): BacktestSetupResult {
  return {
    method,
    stats: summarise(trades, skipped),
    trades,
    equity: equityFromTrades(trades),
  };
}

/** Run both setups over one universe and package the A/B result. */
export function buildScope(
  input: ScopeInput,
  config: Omit<BacktestConfig, 'method'>,
): BacktestScope {
  const symbols = input.symbols.filter(
    (symbol) => !EXCLUDED_SYMBOLS.has(symbol),
  );
  const fractalTrades: BacktestTrade[] = [];
  const atrTrades: BacktestTrade[] = [];
  let fractalSkipped = 0;
  let atrSkipped = 0;
  let contributing = 0;

  for (const symbol of symbols) {
    const bars = input.barsFor(symbol);
    if (bars.length < 3) continue;
    contributing += 1;

    const fractal = runSetup(symbol, bars, { ...config, method: 'fractal' });
    fractalTrades.push(...fractal.trades);
    fractalSkipped += fractal.skipped;

    const atr = runSetup(symbol, bars, { ...config, method: 'atr' });
    atrTrades.push(...atr.trades);
    atrSkipped += atr.skipped;
  }

  return {
    key: input.key,
    label: input.label,
    symbols: contributing,
    fractal: setupResult('fractal', fractalTrades, fractalSkipped),
    atr: setupResult('atr', atrTrades, atrSkipped),
  };
}

/** Union of the primary indices, minus the demerger-affected symbols. */
export function coreUniverse(indices: SnapshotIndex[]): string[] {
  const set = new Set<string>();
  for (const index of indices) {
    for (const symbol of index.symbols) set.add(symbol);
  }
  return [...set]
    .filter((symbol) => !EXCLUDED_SYMBOLS.has(symbol))
    .sort();
}

/** Flag close-to-close gaps that look like an unadjusted corporate action. */
export function corporateActionWarnings(
  symbol: string,
  bars: Bar[],
): string[] {
  const warnings: string[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const previous = bars[i - 1].c;
    if (previous <= 0) continue;
    const change = bars[i].c / previous - 1;
    if (Math.abs(change) >= CORPORATE_ACTION_GAP) {
      warnings.push(
        `${symbol}: ${change > 0 ? '+' : ''}${(change * 100).toFixed(1)}% close-to-close on ${bars[i].d}. ` +
          'This may be an unadjusted corporate action; entries and stops around it can be invalid.',
      );
    }
  }
  return warnings;
}
