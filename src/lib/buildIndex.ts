import { fetchConstituents } from './sources/indices';
import { fetchSymbols, type ScripcodeMap, type SymbolReport } from './symbols';
import type { IndexDataset, IndexInfo, Snapshot } from './types';

export type BuildIndexOptions = {
  info: IndexInfo;
  core: Snapshot;
  scripcodes?: ScripcodeMap;
  concurrency?: number;
  onProgress?: (done: number, total: number, symbol: string) => void;
};

export type BuildIndexResult = {
  dataset: IndexDataset;
  report: {
    key: string;
    requested: number;
    reused: number;
    fetched: number;
    failed: number;
    durationMs: number;
    fetchMs: number;
    symbols: SymbolReport[];
  };
  scripcodes: ScripcodeMap;
};

/**
 * Load one non-primary index on demand.
 *
 * Members already present in the core snapshot are reused, so only the
 * remaining symbols hit the charting API. The dataset is versioned with the
 * core snapshot; a refresh invalidates it naturally.
 */
export async function buildIndexDataset(
  options: BuildIndexOptions,
): Promise<BuildIndexResult> {
  const started = Date.now();
  const scripcodes = options.scripcodes ?? {};
  const symbols = await fetchConstituents(options.info.key);
  const missing = symbols.filter((symbol) => !options.core.symbols[symbol]);

  const fetched = missing.length
    ? await fetchSymbols(missing, {
        scripcodes,
        fromDate: options.core.historyFrom,
        toDate: options.core.asOf,
        concurrency: options.concurrency ?? 8,
        onProgress: options.onProgress,
      })
    : { data: {}, reports: [] as SymbolReport[], latest: null, fetchMs: 0 };

  const dataset: IndexDataset = {
    version: options.core.version,
    asOf: options.core.asOf,
    index: { ...options.info, symbols },
    data: fetched.data,
  };

  return {
    dataset,
    report: {
      key: options.info.key,
      requested: symbols.length,
      reused: symbols.length - missing.length,
      fetched: missing.length,
      failed: missing.length - Object.keys(fetched.data).length,
      durationMs: Date.now() - started,
      fetchMs: fetched.fetchMs,
      symbols: fetched.reports,
    },
    scripcodes,
  };
}
