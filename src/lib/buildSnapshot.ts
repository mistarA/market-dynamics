import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fetchCatalogue, fetchMemberships, unionSymbols } from './sources/indices';
import { fetchSymbols, type ScripcodeMap, type SymbolReport } from './symbols';
import { istMarketState } from './date';
import type { IndexInfo, Snapshot, SnapshotIndex } from './types';

/** Number of leading catalogue entries that are always loaded up front. */
export const PRIMARY_COUNT = 4;

export type BuildOptions = {
  root?: string;
  /** Years of daily history to request. Default 3. */
  years?: number;
  /** Parallel NSE requests. Default 8. */
  concurrency?: number;
  /** Last date to include (ISO). Defaults to today in IST. */
  toDate?: string;
  /** Write public/data/snapshot.json. Disable in read-only serverless runtimes. */
  writeLocal?: boolean;
  /** Existing scripcode cache; the updated map is returned. */
  scripcodes?: ScripcodeMap;
  onProgress?: (done: number, total: number, symbol: string) => void;
};

export type BuildReport = {
  asOf: string;
  generatedAt: string;
  durationMs: number;
  total: number;
  ok: number;
  failed: number;
  stale: number;
  short: number;
  coverage: number;
  catalogueCount: number;
  indexCounts: Record<string, number>;
  warnings: string[];
  timings: { catalogueMs: number; fetchMs: number; writeMs: number };
  symbols: SymbolReport[];
};

export type BuildResult = {
  snapshot: Snapshot;
  report: BuildReport;
  scripcodes: ScripcodeMap;
};

const DAY_MS = 86_400_000;

function isoDaysAgo(days: number, from: Date): string {
  return new Date(from.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

function versionFor(asOf: string, generatedAt: string): string {
  const stamp = generatedAt.replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${asOf}.${stamp}`;
}

export function primaryInfos(catalogue: IndexInfo[]): IndexInfo[] {
  return catalogue.slice(0, PRIMARY_COUNT);
}

/**
 * Build the core snapshot from the NSE catalogue.
 *
 * Everything comes from the API: the 119-index catalogue, the first four
 * memberships, and daily bars for their union. No index or constituent data is
 * packaged with the app.
 */
export async function buildSnapshot(
  options: BuildOptions = {},
): Promise<BuildResult> {
  const root = options.root ?? process.cwd();
  const years = options.years ?? 3;
  const concurrency = options.concurrency ?? 8;
  const writeLocal = options.writeLocal ?? true;
  const scripcodes = options.scripcodes ?? {};
  const warnings: string[] = [];

  const catalogueStarted = Date.now();
  const catalogue = await fetchCatalogue();
  if (catalogue.length <= PRIMARY_COUNT) {
    warnings.push(
      `Catalogue returned only ${catalogue.length} indices; all are primary.`,
    );
  }
  const primary = primaryInfos(catalogue);

  const memberships = await fetchMemberships(primary, 4);
  const indices: SnapshotIndex[] = memberships.map(({ info, symbols }) => {
    if (symbols.length === 0) {
      warnings.push(`${info.name} returned no constituents.`);
    }
    return { ...info, symbols };
  });
  const catalogueMs = Date.now() - catalogueStarted;

  const market = istMarketState();
  const toDate = options.toDate ?? market.today;
  const fromDate = isoDaysAgo(
    Math.round(years * 365),
    new Date(`${toDate}T00:00:00Z`),
  );

  const tickers = unionSymbols(indices);
  const started = Date.now();
  const fetched = await fetchSymbols(tickers, {
    scripcodes,
    fromDate,
    toDate,
    concurrency,
    onProgress: options.onProgress,
  });

  const asOf = fetched.latest ?? toDate;
  const generatedAt = new Date().toISOString();
  const okReports = fetched.reports.filter((report) => report.bars > 0);
  const stale = okReports.filter((report) => report.last !== asOf).length;
  const short = okReports.filter((report) => report.bars < 300).length;

  const snapshot: Snapshot = {
    version: versionFor(asOf, generatedAt),
    asOf,
    generatedAt,
    source: 'nse-charting',
    historyFrom: fromDate,
    catalogue,
    indices,
    symbols: fetched.data,
  };

  const writeStarted = Date.now();
  if (writeLocal) {
    const outPath = resolve(root, 'public/data/snapshot.json');
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(snapshot), 'utf8');
  }
  const writeMs = Date.now() - writeStarted;

  const report: BuildReport = {
    asOf,
    generatedAt,
    durationMs: Date.now() - started,
    total: tickers.length,
    ok: okReports.length,
    failed: tickers.length - okReports.length,
    stale,
    short,
    coverage: tickers.length ? okReports.length / tickers.length : 0,
    catalogueCount: catalogue.length,
    indexCounts: Object.fromEntries(
      indices.map((index) => [index.slug, index.symbols.length]),
    ),
    warnings,
    timings: { catalogueMs, fetchMs: fetched.fetchMs, writeMs },
    symbols: fetched.reports,
  };

  return { snapshot, report, scripcodes };
}
