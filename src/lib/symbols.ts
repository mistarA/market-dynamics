import { fetchDaily, resolveSymbol } from './sources/charting';
import { mapPool } from './concurrency';
import type { Bar, BarTuple, ResolvedSymbol, SnapshotSymbol } from './types';

/**
 * Runtime scripcode cache.
 *
 * `data/scripcodes.json` used to be checked in. It is now persisted wherever
 * the app runs: a gitignored local cache, or a Blob object server-side.
 */
export type ScripcodeEntry = {
  symbol: string;
  instrumentType?: string;
  scripcode: string;
  description?: string;
  exchange?: string;
  fullname?: string;
  type: 'Equity' | 'Index';
};

export type ScripcodeMap = Record<string, ScripcodeEntry>;

export type SymbolReport = {
  symbol: string;
  name?: string;
  bars: number;
  first: string | null;
  last: string | null;
  lastClose: number | null;
  scripcode: string | null;
  error?: string;
};

export type FetchSymbolsOptions = {
  scripcodes: ScripcodeMap;
  fromDate: string;
  toDate: string;
  concurrency?: number;
  onProgress?: (done: number, total: number, symbol: string) => void;
};

export type FetchSymbolsResult = {
  data: Record<string, SnapshotSymbol>;
  reports: SymbolReport[];
  /** Latest last-bar date across symbols that returned data. */
  latest: string | null;
  fetchMs: number;
};

function fromEntry(ticker: string, entry: ScripcodeEntry): ResolvedSymbol {
  return {
    ticker,
    symbol: entry.symbol || `${ticker}-EQ`,
    scripcode: String(entry.scripcode),
    type: entry.type ?? 'Equity',
    description: entry.description ?? entry.symbol ?? ticker,
  };
}

export function toTuples(bars: Bar[]): BarTuple[] {
  return bars.map((bar) => [bar.d, bar.o, bar.h, bar.l, bar.c, bar.v]);
}

/**
 * Fetch bars for a set of tickers. Failures are recorded per symbol instead of
 * failing the whole batch; a stale cached scripcode is re-resolved once.
 */
export async function fetchSymbols(
  symbols: string[],
  options: FetchSymbolsOptions,
): Promise<FetchSymbolsResult> {
  const concurrency = options.concurrency ?? 8;
  const started = Date.now();
  let done = 0;

  const results = await mapPool(symbols, concurrency, async (ticker) => {
    const report: SymbolReport = {
      symbol: ticker,
      bars: 0,
      first: null,
      last: null,
      lastClose: null,
      scripcode: options.scripcodes[ticker]?.scripcode ?? null,
    };

    const attempt = async (resolved: ResolvedSymbol) => {
      const bars = await fetchDaily(resolved, options.fromDate, options.toDate);
      if (!bars.length) throw new Error('empty series');
      return bars;
    };

    try {
      let resolved: ResolvedSymbol;
      if (options.scripcodes[ticker]) {
        resolved = fromEntry(ticker, options.scripcodes[ticker]);
      } else {
        resolved = await resolveSymbol(ticker, { type: 'Equity' });
        options.scripcodes[ticker] = {
          symbol: resolved.symbol,
          scripcode: resolved.scripcode,
          description: resolved.description,
          type: resolved.type,
        };
      }

      report.scripcode = resolved.scripcode;
      report.name = resolved.description;

      let bars: Bar[];
      try {
        bars = await attempt(resolved);
      } catch (firstError) {
        // A cached scripcode can go stale after a symbol change; re-resolve.
        const fresh = await resolveSymbol(ticker, { type: 'Equity' });
        options.scripcodes[ticker] = {
          symbol: fresh.symbol,
          scripcode: fresh.scripcode,
          description: fresh.description,
          type: fresh.type,
        };
        report.scripcode = fresh.scripcode;
        report.name = fresh.description;
        try {
          bars = await attempt(fresh);
        } catch {
          throw firstError;
        }
      }

      report.bars = bars.length;
      report.first = bars[0].d;
      report.last = bars[bars.length - 1].d;
      report.lastClose = bars[bars.length - 1].c;

      return { report, bars };
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
      return { report, bars: [] as Bar[] };
    } finally {
      done += 1;
      options.onProgress?.(done, symbols.length, ticker);
    }
  });

  const data: Record<string, SnapshotSymbol> = {};
  const reports: SymbolReport[] = [];

  for (const { report, bars } of results) {
    reports.push(report);
    if (!bars.length) continue;
    data[report.symbol] = {
      name: report.name ?? report.symbol,
      industry: '—',
      scripcode: report.scripcode ?? '',
      type: 'Equity',
      bars: toTuples(bars),
      listedFrom: report.first ?? undefined,
    };
  }

  const latest = reports.reduce<string | null>(
    (max, report) => (report.last && (!max || report.last > max) ? report.last : max),
    null,
  );

  return { data, reports, latest, fetchMs: Date.now() - started };
}
