export type Timeframe = 'day' | 'week' | 'month';
export type Confirmation = 1 | 2;
export type Direction = 'bullish' | 'bearish';
export type Trend = 0 | 1 | -1;

/** Compact daily bar: date, open, high, low, close, volume. */
export type BarTuple = [string, number, number, number, number, number];

export type Bar = {
  d: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

/** One index from NSE's catalogue. `key` is the value accepted by the API. */
export type IndexInfo = {
  key: string;
  slug: string;
  name: string;
  short: string;
  description: string;
  /** F&O tradable name, when NSE publishes one. */
  fno?: string | null;
};

export type SnapshotIndex = IndexInfo & {
  symbols: string[];
};

export type SnapshotSymbol = {
  name: string;
  industry: string;
  scripcode: string;
  type: 'Equity' | 'Index';
  bars: BarTuple[];
  listedFrom?: string;
};

export type Snapshot = {
  version: string;
  asOf: string;
  generatedAt: string;
  source: 'nse-charting' | 'bhavcopy';
  /** Earliest date requested, reused when lazily loading more indices. */
  historyFrom: string;
  /** Every index NSE returns, in display order. */
  catalogue: IndexInfo[];
  /** The first four catalogue entries, with memberships and bars. */
  indices: SnapshotIndex[];
  symbols: Record<string, SnapshotSymbol>;
};

/**
 * A lazy index. Only symbols that are missing from the core snapshot are
 * included, so loading an overlapping index costs little.
 */
export type IndexDataset = {
  version: string;
  asOf: string;
  index: SnapshotIndex;
  data: Record<string, SnapshotSymbol>;
};

export type ResolvedSymbol = {
  ticker: string;
  symbol: string;
  scripcode: string;
  type: 'Equity' | 'Index';
  description: string;
};

export type Pivot = {
  idx: number;
  date: string;
  price: number;
  kind: 'high' | 'low';
  confirmIdx: number;
};

export type MssEvent = {
  idx: number;
  date: string;
  direction: Direction;
  level: number;
  close: number;
  breakoutPct: number;
  /**
   * The opposite swing known when the flip confirmed: the last confirmed low
   * for a bullish flip, the last confirmed high for a bearish flip. Frozen at
   * the event, so a backtest never reads a swing that was confirmed later.
   */
  stopLevel: number | null;
  /** Bar of the swing that provides the stop, when one was known. */
  stopIdx: number | null;
  stopDate: string | null;
};

export type Structure = {
  allBars: Bar[];
  detectionBars: Bar[];
  events: MssEvent[];
  pivots: Pivot[];
  trend: Trend;
  activeHigh: number | null;
  activeLow: number | null;
  lastEvent: MssEvent | null;
  barsSince: number | null;
};

export type MarketState = {
  today: string;
  open: boolean;
  label: string;
};

export type AnalysisContext = {
  /** Today's bar is still forming and must not confirm structure. */
  provisional: boolean;
  /** Today's date in IST, used to tag the live bar. */
  today: string;
  /** Latest date across the whole snapshot, used to flag stale symbols. */
  asOf: string;
};

export type RowStatus = 'ok' | 'insufficient' | 'stale';

export type Row = {
  symbol: string;
  name: string;
  industry: string;
  close: number;
  changePct: number | null;
  direction: Direction | null;
  barsSince: number | null;
  eventDate: string | null;
  eventClose: number | null;
  level: number | null;
  breakoutPct: number | null;
  sincePct: number | null;
  trend: Trend;
  activeHigh: number | null;
  activeLow: number | null;
  spark: number[];
  barCount: number;
  lastDate: string;
  provisional: boolean;
  status: RowStatus;
};

export type Detail = {
  symbol: string;
  name: string;
  industry: string;
  timeframe: Timeframe;
  confirmation: Confirmation;
  /** Swing detector that produced this structure. */
  method: SwingMethod;
  bars: Bar[];
  events: MssEvent[];
  pivots: Pivot[];
  activeHigh: number | null;
  activeLow: number | null;
  lastEvent: MssEvent | null;
  barsSince: number | null;
  close: number;
  changePct: number | null;
  provisional: boolean;
};

/* --------------------------------------------------------------- backtest */

export type SwingMethod = 'fractal' | 'atr';

export type BacktestExitReason =
  | 'target'
  | 'stop'
  | 'flip'
  | 'ambiguous'
  | 'open';

export type BacktestTrade = {
  symbol: string;
  direction: Direction;
  /** Bar that confirmed the MSS flip; entry is the next bar's open. */
  signalDate: string;
  signalLevel: number;
  entryIdx: number;
  entryDate: string;
  entry: number;
  stop: number;
  target: number;
  risk: number;
  riskPct: number;
  exitIdx: number | null;
  exitDate: string | null;
  exit: number | null;
  exitReason: BacktestExitReason;
  barsHeld: number | null;
  /** Net R after costs. Null while the outcome is unknown. */
  r: number | null;
  /** Best excursion in R while held, gross of costs. */
  mfeR: number;
  /** Worst excursion in R while held (<= 0), gross of costs. */
  maeR: number;
};

export type BacktestStats = {
  /** Entry signals that produced a position. */
  trades: number;
  wins: number;
  losses: number;
  scratches: number;
  ambiguous: number;
  open: number;
  /** Flips skipped because the open was already beyond the stop. */
  skipped: number;
  targetHits: number;
  stopHits: number;
  flipExits: number;
  winRate: number | null;
  /** All ambiguous trades counted as losses. */
  winRateLower: number | null;
  /** All ambiguous trades counted as wins. */
  winRateUpper: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  totalR: number;
  maxDrawdownR: number;
  avgRiskPct: number | null;
  avgBarsHeld: number | null;
  /** Average best excursion among resolved trades, in R. */
  avgMfeR: number | null;
  /** Average worst excursion among resolved trades, in R. */
  avgMaeR: number | null;
  /** Losing trades that never reached +0.5R of unrealized profit. */
  lossesUnderHalfR: number;
  /** Winning trades that first drew down at least 0.5R. */
  winsAfterHalfR: number;
};

export type BacktestEquityPoint = {
  d: string;
  r: number;
};

export type BacktestSetupResult = {
  method: SwingMethod;
  stats: BacktestStats;
  trades: BacktestTrade[];
  equity: BacktestEquityPoint[];
};

export type BacktestScopeKey = 'stock' | 'index' | 'core';

export type BacktestScope = {
  key: BacktestScopeKey;
  label: string;
  /** Symbols with enough history that actually contributed trades. */
  symbols: number;
  fractal: BacktestSetupResult;
  atr: BacktestSetupResult;
};

export type BacktestReport = {
  indexKey: string;
  indexName: string;
  symbol: string;
  symbolName: string;
  generatedAt: string;
  from: string;
  to: string;
  costsBps: number;
  scopes: BacktestScope[];
  warnings: string[];
};
