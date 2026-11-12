import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BacktestPanel } from './components/BacktestPanel';
import { DetailDrawer } from './components/DetailDrawer';
import { PerfOverlay } from './components/PerfOverlay';
import { Table } from './components/Table';
import {
  fetchIndexDataset,
  fetchServerVersion,
  fetchSnapshot,
  triggerRefresh,
} from './lib/api';
import {
  readCachedDataset,
  readCachedSnapshot,
  writeCachedDataset,
  writeCachedSnapshot,
} from './lib/cache';
import {
  formatDate,
  formatDateTime,
  istMarketState,
  TIMEFRAME_LABEL,
} from './lib/date';
import { bootAt, now, recordMetric, since } from './lib/perf';
import {
  filterRows,
  sortRows,
  summarise,
  type SortKey,
} from './lib/rank';
import type {
  AnalysisContext,
  BacktestTrade,
  Confirmation,
  Detail,
  Direction,
  IndexDataset,
  IndexInfo,
  Row,
  Snapshot,
  SwingMethod,
  Timeframe,
} from './lib/types';
import { AnalysisClient } from './lib/workerClient';

type Theme = 'dark' | 'light';

const TIMEFRAMES: Timeframe[] = ['day', 'week', 'month'];
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Most recent shift' },
  { key: 'symbol', label: 'Symbol A–Z' },
  { key: 'change', label: 'Day change' },
  { key: 'since', label: 'Move since shift' },
];

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem('mss-theme');
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* storage can be unavailable */
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

function upsertDataset(
  current: IndexDataset[],
  next: IndexDataset,
): IndexDataset[] {
  const found = current.some((item) => item.index.key === next.index.key);
  if (!found) return [...current, next];
  return current.map((item) =>
    item.index.key === next.index.key ? next : item,
  );
}

export default function App() {
  const market = useMemo(() => istMarketState(), []);
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#f4f6fa' : '#0a0d12');
    try {
      localStorage.setItem('mss-theme', theme);
    } catch {
      /* storage can be unavailable */
    }
  }, [theme]);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [, setSnapshotSource] = useState<'cache' | 'network'>('network');
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [indexKey, setIndexKey] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<IndexDataset[]>([]);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreQuery, setMoreQuery] = useState('');
  const [dataRevision, setDataRevision] = useState(0);

  const [timeframe, setTimeframe] = useState<Timeframe>('day');
  const [confirmation, setConfirmation] = useState<Confirmation>(1);
  const [direction, setDirection] = useState<Direction | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'recent',
    dir: 'asc',
  });

  const [rows, setRows] = useState<Row[]>([]);
  const [, setComputing] = useState(false);
  const [, setComputeMs] = useState<number | null>(null);
  const [workerReady, setWorkerReady] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [backtestOpen, setBacktestOpen] = useState(false);
  const [inspectTrade, setInspectTrade] = useState<{
    method: SwingMethod;
    symbol: string;
    entryDate: string;
    direction: Direction;
  } | null>(null);

  const clientRef = useRef<AnalysisClient | null>(null);
  const firstTableRef = useRef(false);
  const tabsWrapRef = useRef<HTMLDivElement | null>(null);

  const provisional = Boolean(
    snapshot && market.open && snapshot.asOf === market.today,
  );

  const context = useMemo<AnalysisContext | null>(
    () =>
      snapshot
        ? { provisional, today: market.today, asOf: snapshot.asOf }
        : null,
    [snapshot, provisional, market.today],
  );

  const applySnapshot = useCallback((next: Snapshot, source: 'cache' | 'network') => {
    setSnapshot((current) => {
      if (current && current.version === next.version) return current;
      return next;
    });
    setSnapshotSource(source);
    setBooting(false);
    setError(null);
  }, []);

  /* ---------------------------------------------------------------- boot */
  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      const cacheStart = now();
      const cached = await readCachedSnapshot();
      since('app:cache-read', cacheStart);
      if (cancelled) return;
      if (cached) applySnapshot(cached, 'cache');

      const fetchStart = now();
      let fresh: Snapshot | null = null;
      try {
        fresh = await fetchSnapshot();
      } catch (caught) {
        if (!cancelled && !cached) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Unable to load the snapshot',
          );
          setBooting(false);
        }
      }
      since('app:snapshot-fetch', fetchStart);

      if (cancelled || !fresh) return;

      if (cached && cached.version === fresh.version) {
        // Cache is current; keep rendering it so the worker is not rebuilt.
        setSnapshotSource('cache');
      } else {
        applySnapshot(fresh, 'network');
        void writeCachedSnapshot(fresh);
        if (cached) setNotice('Snapshot updated from the server.');
      }

      const versionStart = now();
      const serverVersion = await fetchServerVersion();
      since('app:version-check', versionStart);
      if (cancelled || !serverVersion || serverVersion === fresh.version) return;

      // A newer build exists; replace it in the background.
      try {
        const updated = await fetchSnapshot();
        if (cancelled) return;
        applySnapshot(updated, 'network');
        void writeCachedSnapshot(updated);
        setNotice('Newer snapshot loaded.');
      } catch {
        /* non-fatal: keep the current snapshot */
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [applySnapshot]);

  /* ------------------------------------------------------ snapshot switch */
  useEffect(() => {
    if (!snapshot) return;
    setDatasets([]);
    setIndexKey((current) => {
      if (current && snapshot.indices.some((item) => item.key === current)) {
        return current;
      }
      return snapshot.indices[0]?.key ?? null;
    });
    setSelected(null);
    setMoreOpen(false);
    setDataRevision((value) => value + 1);
  }, [snapshot?.version]);

  /* -------------------------------------------------------------- worker */
  useEffect(() => {
    if (!snapshot) return;
    const client = new AnalysisClient();
    clientRef.current = client;
    let cancelled = false;
    setWorkerReady(false);
    const start = now();

    client
      .init(snapshot)
      .then(() => {
        if (cancelled) return;
        since('app:worker-init', start);
        setWorkerReady(true);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Worker failed');
      });

    return () => {
      cancelled = true;
      client.terminate();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [snapshot]);

  /* ------------------------------------------------------------- compute */
  useEffect(() => {
    const client = clientRef.current;
    if (!snapshot || !context || !workerReady || !client || !indexKey) return;

    let cancelled = false;
    setComputing(true);
    const start = now();

    client
      .compute(indexKey, timeframe, confirmation, context)
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setComputeMs(result.computeMs);
        setComputing(false);
        since(`app:compute:${timeframe}:${confirmation}`, start);
        if (!firstTableRef.current) {
          firstTableRef.current = true;
          recordMetric('app:first-table', performance.now() - bootAt);
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setComputing(false);
        setError(caught instanceof Error ? caught.message : 'Compute failed');
      });

    return () => {
      cancelled = true;
    };
  }, [
    snapshot,
    context,
    workerReady,
    indexKey,
    timeframe,
    confirmation,
    dataRevision,
  ]);

  /* -------------------------------------------------------------- detail */
  useEffect(() => {
    const client = clientRef.current;
    if (!selected || !context || !workerReady || !client) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    client
      .detail(selected, timeframe, confirmation, context)
      .then((result) => {
        if (cancelled) return;
        setDetail(result.detail);
        setDetailLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected, context, workerReady, timeframe, confirmation, dataRevision]);

  /* --------------------------------------------------------------- notice */
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  /* --------------------------------------------------------- dismiss more */
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        tabsWrapRef.current &&
        !tabsWrapRef.current.contains(event.target as Node)
      ) {
        setMoreOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  const index = useMemo(() => {
    if (!snapshot || !indexKey) return null;
    return (
      snapshot.indices.find((item) => item.key === indexKey) ??
      datasets.find((item) => item.index.key === indexKey)?.index ??
      null
    );
  }, [snapshot, indexKey, datasets]);

  const catalogue = snapshot?.catalogue ?? [];

  const moreIndices = useMemo(() => {
    const primary = new Set(snapshot?.indices.map((item) => item.key) ?? []);
    const needle = moreQuery.trim().toUpperCase();
    return catalogue
      .filter((item) => !primary.has(item.key))
      .filter((item) => {
        if (!needle) return true;
        return (
          item.key.toUpperCase().includes(needle) ||
          item.name.toUpperCase().includes(needle) ||
          item.short.toUpperCase().includes(needle)
        );
      });
  }, [catalogue, snapshot, moreQuery]);

  const loadedKeys = useMemo(
    () => new Set(datasets.map((item) => item.index.key)),
    [datasets],
  );

  const visibleRows = useMemo(
    () => sortRows(filterRows(rows, { direction, query }), sort.key, sort.dir),
    [rows, direction, query, sort],
  );

  const summary = useMemo(() => summarise(rows), [rows]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.symbol === selected) ?? null,
    [rows, selected],
  );

  const handleInspectTrade = (
    method: SwingMethod,
    trade: BacktestTrade,
    targetIndex: string,
  ) => {
    setBacktestOpen(false);
    setInspectTrade({
      method,
      symbol: trade.symbol,
      entryDate: trade.entryDate,
      direction: trade.direction,
    });
    setIndexKey(targetIndex);
    setTimeframe('day');
    setSelected(trade.symbol);
  };

  // A trade inspection only belongs to the symbol that opened it. Selecting a
  // different stock, or closing the drawer, drops the overlay.
  useEffect(() => {
    if (inspectTrade && inspectTrade.symbol !== selected) {
      setInspectTrade(null);
    }
  }, [inspectTrade, selected]);

  const handleSelectSymbol = (symbol: string) => {
    setInspectTrade(null);
    setSelected(symbol);
  };

  const handleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'symbol' || key === 'recent' ? 'asc' : 'desc' },
    );
  };

  const handleSortSelect = (key: SortKey) => {
    setSort({
      key,
      dir: key === 'symbol' || key === 'recent' ? 'asc' : 'desc',
    });
  };

  const activateIndex = (key: string) => {
    setIndexKey(key);
    setSelected(null);
    setMoreOpen(false);
  };

  const loadIndex = async (info: IndexInfo) => {
    const client = clientRef.current;
    if (!snapshot || !client || loadingKey) return;

    setMoreOpen(false);
    setSelected(null);
    setNotice(null);
    setLoadingKey(info.key);
    const started = now();

    try {
      const cached = await readCachedDataset(snapshot.version, info.key);
      if (cached) {
        await client.attach(cached);
        setDatasets((current) => upsertDataset(current, cached));
        setIndexKey(info.key);
        setDataRevision((value) => value + 1);
      }

      try {
        const fresh = await fetchIndexDataset(info.key);
        if (fresh.version !== snapshot.version) {
          throw new Error('The snapshot changed while loading. Reload the page.');
        }
        await client.attach(fresh);
        setDatasets((current) => upsertDataset(current, fresh));
        setIndexKey(info.key);
        setDataRevision((value) => value + 1);
        void writeCachedDataset(fresh);
        setNotice(
          `${fresh.index.name} loaded · ${fresh.index.symbols.length} constituents, ` +
            `${Object.keys(fresh.data).length} supplementary symbols${
              cached ? ' (updated)' : ''
            }.`,
        );
      } catch (caught) {
        if (!cached) throw caught;
        setNotice(`Using cached ${info.name}; refresh failed.`);
      }
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : `Could not load ${info.name}`,
      );
    } finally {
      since(`app:index-load:${info.slug}`, started);
      setLoadingKey(null);
    }
  };

  const handleMoreSelect = (info: IndexInfo) => {
    if (loadedKeys.has(info.key)) {
      activateIndex(info.key);
      return;
    }
    void loadIndex(info);
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setNotice(null);
    const start = now();

    try {
      const ok = await triggerRefresh();
      if (!ok) {
        setNotice(
          'Refresh endpoint unavailable here. Run “npm run backfill” to rebuild the local snapshot.',
        );
        return;
      }
      const fresh = await fetchSnapshot();
      applySnapshot(fresh, 'network');
      void writeCachedSnapshot(fresh);
      const serverVersion = await fetchServerVersion();
      if (serverVersion) {
        setNotice(`Snapshot rebuilt · ${serverVersion}`);
      } else {
        setNotice('Snapshot rebuilt.');
      }
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Refresh failed');
    } finally {
      since('app:refresh-apply', start);
      setRefreshing(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__row">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <h1>
              Structure shifts<span className="brand__accent">.</span>
            </h1>
          </div>

          {snapshot && (
            <div className="tabs-wrap" ref={tabsWrapRef}>
              <nav className="tabs" aria-label="Index">
                {snapshot.indices.map((item) => (
                  <button
                    key={item.key}
                    className={`tab ${item.key === indexKey ? 'is-active' : ''}`}
                    onClick={() => activateIndex(item.key)}
                  >
                    <span>{item.name}</span>
                    <span className="tab__count">{item.symbols.length}</span>
                  </button>
                ))}
                {datasets.map((dataset) => (
                  <button
                    key={dataset.index.key}
                    className={`tab ${
                      dataset.index.key === indexKey ? 'is-active' : ''
                    }`}
                    onClick={() => activateIndex(dataset.index.key)}
                  >
                    <span>{dataset.index.name}</span>
                    <span className="tab__count">
                      {dataset.index.symbols.length}
                    </span>
                  </button>
                ))}
                <button
                  className={`tab tab--more ${moreOpen ? 'is-active' : ''}`}
                  onClick={() => setMoreOpen((value) => !value)}
                  disabled={
                    !workerReady || catalogue.length <= snapshot.indices.length
                  }
                  aria-expanded={moreOpen}
                  aria-haspopup="dialog"
                >
                  {loadingKey ? <span className="spinner" /> : null}
                  <span>{loadingKey ? 'Loading…' : 'Load more'}</span>
                  <span className="tab__count">
                    {Math.max(catalogue.length - snapshot.indices.length, 0)}
                  </span>
                </button>
              </nav>

              {moreOpen && (
                <div className="more" role="dialog" aria-label="More indices">
                  <div className="more__head">
                    <input
                      type="search"
                      value={moreQuery}
                      autoFocus
                      placeholder="Search all NSE indices"
                      onChange={(event) => setMoreQuery(event.target.value)}
                    />
                    <span>{moreIndices.length}</span>
                  </div>
                  <ul className="more__list">
                    {moreIndices.map((item) => {
                      const loaded = loadedKeys.has(item.key);
                      const isLoading = loadingKey === item.key;
                      return (
                        <li key={item.key}>
                          <button
                            className={`more__item ${
                              item.key === indexKey ? 'is-active' : ''
                            }`}
                            onClick={() => handleMoreSelect(item)}
                            disabled={Boolean(loadingKey)}
                          >
                            <span className="more__name">{item.name}</span>
                            <span className="more__meta">
                              {item.fno ? <em>F&amp;O</em> : null}
                              {loaded ? (
                                <em className="is-loaded">loaded</em>
                              ) : null}
                              {isLoading ? <span className="spinner" /> : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                    {moreIndices.length === 0 && (
                      <li className="more__empty">No index matches.</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="topbar__right">
            {snapshot && (
              <div className="asof">
                <span
                  className={`marketdot ${market.open ? 'is-open' : ''}`}
                />
                <strong>{market.label}</strong>
                <span className="asof__meta">
                  {formatDate(snapshot.asOf)} ·{' '}
                  {provisional ? 'provisional' : 'EOD'}
                </span>
              </div>
            )}
            <button
              className="btn btn--ghost btn--theme"
              onClick={() =>
                setTheme((value) => (value === 'dark' ? 'light' : 'dark'))
              }
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              <span aria-hidden="true">
                {theme === 'dark' ? '☀' : '☾'}
              </span>
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => {
                setSelected(null);
                setInspectTrade(null);
                setBacktestOpen(true);
              }}
              disabled={!snapshot || !workerReady}
              title="Run the fractal vs ATR backtest"
            >
              Backtest
            </button>
            <button
              className="btn btn--ghost"
              onClick={handleRefresh}
              disabled={refreshing || !snapshot}
            >
              {refreshing ? <span className="spinner" /> : null}
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {snapshot && (
          <div className="topbar__row topbar__row--controls">
            <div className="controls">
              <div className="segmented" role="group" aria-label="Timeframe">
                {TIMEFRAMES.map((item) => (
                  <button
                    key={item}
                    className={item === timeframe ? 'is-active' : ''}
                    onClick={() => setTimeframe(item)}
                  >
                    {TIMEFRAME_LABEL[item]}
                  </button>
                ))}
              </div>

              <div
                className="segmented"
                role="group"
                aria-label="Confirmation"
              >
                {([1, 2] as Confirmation[]).map((item) => (
                  <button
                    key={item}
                    className={item === confirmation ? 'is-active' : ''}
                    onClick={() => setConfirmation(item)}
                  >
                    {item} candle{item === 2 ? 's' : ''}
                  </button>
                ))}
              </div>

              <select
                aria-label="Direction"
                title="Direction"
                value={direction}
                onChange={(event) =>
                  setDirection(event.target.value as Direction | 'all')
                }
              >
                <option value="all">All shifts</option>
                <option value="bullish">Bullish only</option>
                <option value="bearish">Bearish only</option>
              </select>

              <select
                aria-label="Sort"
                title="Sort"
                value={sort.key}
                onChange={(event) =>
                  handleSortSelect(event.target.value as SortKey)
                }
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>

              <input
                className="controls__search"
                type="search"
                aria-label="Search"
                title="Search"
                value={query}
                placeholder="Symbol or company"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <div className="statline" aria-label="Index summary">
              <span>
                <strong className="up">{summary.bullish}</strong> bull
              </span>
              <span>
                <strong className="down">{summary.bearish}</strong> bear
              </span>
              <span>
                <strong>{summary.fresh}</strong> fresh
              </span>
              <span>
                median{' '}
                <strong>
                  {summary.medianBars === null
                    ? '—'
                    : `${summary.medianBars}b`}
                </strong>
              </span>
            </div>
          </div>
        )}
      </header>

      {booting && !snapshot && (
        <main className="boot">
          <div className="boot__card">
            <div className="boot__bars" aria-hidden="true">
              {Array.from({ length: 12 }).map((_, index) => (
                <span key={index} style={{ animationDelay: `${index * 60}ms` }} />
              ))}
            </div>
            <h2>Loading the NSE index catalogue</h2>
            <p>
              Fetching memberships and three years of daily candles for the first
              four indices.
            </p>
          </div>
        </main>
      )}

      {error && !snapshot && (
        <main className="boot">
          <div className="boot__card boot__card--error">
            <h2>Snapshot unavailable</h2>
            <p>{error}</p>
            <p className="muted">
              Generate the local snapshot with <code>npm run backfill</code>, then
              reload.
            </p>
            <button className="btn" onClick={() => location.reload()}>
              Retry
            </button>
          </div>
        </main>
      )}

      {snapshot && (
        <main className="shell">
          <section className="panel">
            {visibleRows.length === 0 ? (
              <div className="empty">
                <p>No stocks match the current filters.</p>
                <button
                  className="btn btn--ghost"
                  onClick={() => {
                    setDirection('all');
                    setQuery('');
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <Table
                rows={visibleRows}
                selected={selected}
                sort={sort}
                onSort={handleSort}
                onSelect={handleSelectSymbol}
              />
            )}

            <footer className="panel__foot">
              <span>
                Detection: 3 years · fractal k=2 · close beyond confirmed swing ·
                1 or 2 candle confirmation. Chart view: 6 months.
              </span>
              <span>
                Data: NSE charting API · raw OHLCV ·{' '}
                {formatDateTime(snapshot.generatedAt)}
              </span>
            </footer>
          </section>

          <section className="notes">
            <div>
              <h3>How the ranking works</h3>
              <p>
                A shift is confirmed when a close crosses the latest confirmed
                fractal swing (k=2). With 2-candle confirmation, the level must
                be closed beyond twice, and only levels already confirmed at the
                first close count.
              </p>
            </div>
            <div>
              <h3>Reading the table</h3>
              <p>
                “Broken level” is the swing that failed; “close @ shift” is the
                confirming close. “Since shift” measures the move from that
                close to today. R/S are the nearest unbroken swing high and low.
              </p>
            </div>
            <div>
              <h3>What it is not</h3>
              <p>
                Structure is a lens, not a signal. Recent listings with short
                history are labelled instead of ranked. Data is end-of-day and
                excludes intraday noise. Not investment advice.
              </p>
            </div>
          </section>

          <footer className="site-foot">
            <span>
              {Object.keys(snapshot.symbols).length} core symbols ·{' '}
              {snapshot.indices.length} primary + {datasets.length} loaded of{' '}
              {catalogue.length} indices · snapshot {snapshot.version}
            </span>
            <span>
              Source: NSE charting API. Unlisted intraday moves are not included.
            </span>
          </footer>
        </main>
      )}

      <DetailDrawer
        row={selectedRow}
        detail={detail}
        loading={detailLoading}
        theme={theme}
        focus={inspectTrade}
        onClearFocus={() => setInspectTrade(null)}
        onClose={() => {
          setSelected(null);
          setInspectTrade(null);
        }}
      />

      {snapshot && (
        <BacktestPanel
          open={backtestOpen}
          snapshot={snapshot}
          client={clientRef.current}
          workerReady={workerReady}
          provisional={provisional}
          onClose={() => setBacktestOpen(false)}
          onInspectTrade={handleInspectTrade}
        />
      )}

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}

      <PerfOverlay />
    </div>
  );
}
