/// <reference lib="webworker" />

import { analyse, tuplesToBars } from '../lib/rank';
import {
  buildScope,
  coreUniverse,
  corporateActionWarnings,
} from '../lib/backtest';
import type { WorkerRequest, WorkerResponse } from '../lib/messages';
import type {
  AnalysisContext,
  BacktestReport,
  Bar,
  Confirmation,
  IndexDataset,
  Row,
  Snapshot,
  SnapshotIndex,
  SnapshotSymbol,
  SwingMethod,
  Timeframe,
} from '../lib/types';

let snapshot: Snapshot | null = null;
const datasets = new Map<string, IndexDataset>();
let extraMeta = new Map<string, SnapshotSymbol>();
const dailyCache = new Map<string, Bar[]>();
const rowCache = new Map<string, { rows: Row[]; computeMs: number }>();

function reply(message: WorkerResponse, transfer?: Transferable[]) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(
    message,
    transfer ?? [],
  );
}

function metaFor(symbol: string): SnapshotSymbol | undefined {
  return snapshot?.symbols[symbol] ?? extraMeta.get(symbol);
}

function barsFor(symbol: string): Bar[] {
  const cached = dailyCache.get(symbol);
  if (cached) return cached;
  const meta = metaFor(symbol);
  const bars = meta ? tuplesToBars(meta.bars) : [];
  dailyCache.set(symbol, bars);
  return bars;
}

function indexFor(key: string): SnapshotIndex | null {
  const primary = snapshot?.indices.find((item) => item.key === key);
  if (primary) return primary;
  return datasets.get(key)?.index ?? null;
}

function rebuildExtraMeta() {
  extraMeta = new Map<string, SnapshotSymbol>();
  for (const dataset of datasets.values()) {
    for (const [symbol, meta] of Object.entries(dataset.data)) {
      extraMeta.set(symbol, meta);
    }
  }
}

function handleInit(next: Snapshot) {
  snapshot = next;
  datasets.clear();
  extraMeta.clear();
  dailyCache.clear();
  rowCache.clear();
  reply({
    type: 'ready',
    version: next.version,
    asOf: next.asOf,
    indices: next.indices,
  });
}

function handleAttach(requestId: number, dataset: IndexDataset) {
  if (!snapshot) throw new Error('Worker has no snapshot');
  datasets.set(dataset.index.key, dataset);
  rebuildExtraMeta();
  dailyCache.clear();
  rowCache.clear();
  reply({
    type: 'attached',
    requestId,
    key: dataset.index.key,
    symbols: dataset.index.symbols.length,
    fetched: Object.keys(dataset.data).length,
  });
}

function handleCompute(
  requestId: number,
  indexSlug: string,
  timeframe: Timeframe,
  confirmation: Confirmation,
  method: SwingMethod,
  context: AnalysisContext,
) {
  if (!snapshot) throw new Error('Worker has no snapshot');
  const index = indexFor(indexSlug);
  if (!index) throw new Error(`Unknown index ${indexSlug}`);

  const key = [
    snapshot.version,
    indexSlug,
    timeframe,
    confirmation,
    method,
    context.provisional ? 'p' : 'f',
  ].join('|');

  const cached = rowCache.get(key);
  if (cached) {
    reply({
      type: 'computed',
      requestId,
      rows: cached.rows,
      computeMs: cached.computeMs,
    });
    return;
  }

  const started = performance.now();
  const rows: Row[] = [];

  for (const symbol of index.symbols) {
    const meta = metaFor(symbol);
    if (!meta) continue;
    const { row } = analyse(
      symbol,
      meta,
      timeframe,
      confirmation,
      method,
      context,
      barsFor(symbol),
    );
    rows.push(row);
  }

  const computeMs = performance.now() - started;
  rowCache.set(key, { rows, computeMs });
  reply({ type: 'computed', requestId, rows, computeMs });
}

function handleDetail(
  requestId: number,
  symbol: string,
  timeframe: Timeframe,
  confirmation: Confirmation,
  method: SwingMethod,
  context: AnalysisContext,
) {
  if (!snapshot) throw new Error('Worker has no snapshot');
  const meta = metaFor(symbol);
  if (!meta) throw new Error(`Unknown symbol ${symbol}`);

  const started = performance.now();
  const { detail } = analyse(
    symbol,
    meta,
    timeframe,
    confirmation,
    method,
    context,
    barsFor(symbol),
  );
  reply({
    type: 'detail',
    requestId,
    detail,
    computeMs: performance.now() - started,
  });
}

function handleBacktest(
  requestId: number,
  indexKey: string,
  symbol: string,
  costsBps: number,
  provisional: boolean,
) {
  if (!snapshot) throw new Error('Worker has no snapshot');
  const index = indexFor(indexKey);
  if (!index) throw new Error(`Unknown index ${indexKey}`);
  const meta = metaFor(symbol);
  if (!meta) throw new Error(`Unknown symbol ${symbol}`);

  const started = performance.now();
  const base = {
    confirmation: 1 as Confirmation,
    costsBps,
    dropLast: provisional,
  };
  const barsForSymbol = (item: string) => barsFor(item);

  const scopes = [
    buildScope(
      { key: 'stock', label: symbol, symbols: [symbol], barsFor: barsForSymbol },
      base,
    ),
    buildScope(
      {
        key: 'index',
        label: index.name,
        symbols: index.symbols,
        barsFor: barsForSymbol,
      },
      base,
    ),
    buildScope(
      {
        key: 'core',
        label: 'All core',
        symbols: coreUniverse(snapshot.indices),
        barsFor: barsForSymbol,
      },
      base,
    ),
  ];

  const warnings = corporateActionWarnings(symbol, barsFor(symbol));

  const report: BacktestReport = {
    indexKey,
    indexName: index.name,
    symbol,
    symbolName: meta.name,
    generatedAt: new Date().toISOString(),
    from: snapshot.historyFrom,
    to: snapshot.asOf,
    costsBps,
    scopes,
    warnings,
  };

  reply({
    type: 'backtested',
    requestId,
    report,
    computeMs: performance.now() - started,
  });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  try {
    if (message.type === 'init') {
      handleInit(message.snapshot);
      return;
    }
    if (message.type === 'attach') {
      handleAttach(message.requestId, message.dataset);
      return;
    }
    if (message.type === 'compute') {
      handleCompute(
        message.requestId,
        message.indexSlug,
        message.timeframe,
        message.confirmation,
        message.method,
        message.context,
      );
      return;
    }
    if (message.type === 'detail') {
      handleDetail(
        message.requestId,
        message.symbol,
        message.timeframe,
        message.confirmation,
        message.method,
        message.context,
      );
      return;
    }
    if (message.type === 'backtest') {
      handleBacktest(
        message.requestId,
        message.indexKey,
        message.symbol,
        message.costsBps,
        message.provisional,
      );
      return;
    }
  } catch (error) {
    reply({
      type: 'error',
      requestId: 'requestId' in message ? message.requestId : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
