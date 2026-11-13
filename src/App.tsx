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
const METHOD_OPTIONS: { value: SwingMethod; label: string; title: string }[] = [
  { value: 'fractal', label: 'Fractal', title: 'Fractal swings (k=2)' },
  { value: 'atr', label: 'ATR', title: 'ATR zigzag swings (14, 2×)' },
];
const TIMEFRAME_OPTIONS: { value: Timeframe; label: string }[] = TIMEFRAMES.map(
  (item) => ({ value: item, label: TIMEFRAME_LABEL[item] }),
);
const CONFIRMATION_OPTIONS: { value: Confirmation; label: string }[] = (
  [1, 2] as Confirmation[]
).map((item) => ({
  value: item,
  label: `${item} candle${item === 2 ? 's' : ''}`,
}));
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Most recent shift' },
  { key: 'symbol', label: 'Symbol A–Z' },
  { key: 'change', label: 'Day change' },
  { key: 'since', label: 'Move since shift' },
];
const SORT_SHORT: Record<SortKey, string> = {
  recent: 'Recent',
  symbol: 'A–Z',
  change: 'Day %',
  since: 'Since',
  close: 'LTP',
};
const TIMEFRAME_SHORT: Record<Timeframe, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
};

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem('mss-theme');
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* storage can be unavailable */
  }
  // The ledger look is light by default; the preference is remembered.
  return 'light';
}

function initialMethod(): SwingMethod {
  try {
    const stored = localStorage.getItem('mss-method');
    if (stored === 'fractal' || stored === 'atr') return stored;
  } catch {
    /* storage can be unavailable */
  }
  return 'fractal';
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

/** Small segmented control shared by the toolbar and the phone filter sheet. */
function ChipGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={['segmented', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          className={option.value === value ? 'is-active' : ''}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const market = useMemo(() => istMarketState(), []);
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#f5efe3' : '#15120e');
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
  const [method, setMethod] = useState<SwingMethod>(initialMethod);
  /** Phone-only bottom sheet. Tablets and desktops use inline controls. */
  const [sheet, setSheet] = useState<'filters' | 'sort' | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('mss-method', method);
    } catch {
      /* storage can be unavailable */
    }
  }, [method]);

  useEffect(() => {
    if (!sheet) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheet(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [sheet]);

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
  /** A card chart button opens the drawer straight into the full-screen chart. */
  const [chartOnly, setChartOnly] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** Distance of the current pull-to-refresh drag, in px. */
  const [pull, setPull] = useState(0);
  const pullValue = useRef(0);
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
      .compute(indexKey, timeframe, confirmation, method, context)
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
    method,
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
      .detail(selected, timeframe, confirmation, method, context)
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
  }, [selected, context, workerReady, timeframe, confirmation, method, dataRevision]);

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

  /** Catalogue entries that still need loading, for the mobile index picker. */
  const pendingCatalogue = useMemo(() => {
    const primary = new Set(
      (snapshot?.indices ?? []).map((item) => item.key),
    );
    return catalogue.filter(
      (item) => !loadedKeys.has(item.key) && !primary.has(item.key),
    );
  }, [catalogue, loadedKeys, snapshot]);

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
    setChartOnly(false);
    setSelected(symbol);
  };

  const handleSelectChart = (symbol: string) => {
    setInspectTrade(null);
    setChartOnly(true);
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

  const indexPicker = (className: string) =>
    snapshot ? (
      <select
        className={className}
        aria-label="Index"
        title="Index"
        value={indexKey ?? ''}
        onChange={(event) => {
          const key = event.target.value;
          const loaded = snapshot.indices.find((item) => item.key === key);
          if (loaded) {
            activateIndex(key);
            return;
          }
          const info = catalogue.find((item) => item.key === key);
          if (info) handleMoreSelect(info);
        }}
      >
        {snapshot.indices.map((item) => (
          <option key={item.key} value={item.key}>
            {item.name} · {item.symbols.length}
          </option>
        ))}
        {datasets
          .filter(
            (dataset) =>
              !snapshot.indices.some(
                (item) => item.key === dataset.index.key,
              ),
          )
          .map((dataset) => (
            <option key={dataset.index.key} value={dataset.index.key}>
              {dataset.index.name} · {dataset.index.symbols.length}
            </option>
          ))}
        {pendingCatalogue.length > 0 && (
          <optgroup label="Load index">
            {pendingCatalogue.map((item) => (
              <option key={item.key} value={item.key}>
                {item.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    ) : null;

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

  const refreshRef = useRef(handleRefresh);
  const refreshingRef = useRef(refreshing);
  useEffect(() => {
    refreshRef.current = handleRefresh;
    refreshingRef.current = refreshing;
  });

  /**
   * Pull down at the top of the page to refresh on phones, where the Refresh
   * button would only crowd the top bar.
   */
  useEffect(() => {
    const THRESHOLD = 64;
    const MAX = 96;
    let startY: number | null = null;
    let tracking = false;

    const setDistance = (value: number) => {
      pullValue.current = value;
      setPull(value);
    };

    const usable = () =>
      window.matchMedia('(max-width: 620px)').matches &&
      !refreshingRef.current &&
      window.scrollY <= 0 &&
      !document.querySelector('.drawer, .sheet-layer');

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !usable()) return;
      startY = event.touches[0].clientY;
      tracking = true;
    };

    const onMove = (event: TouchEvent) => {
      if (!tracking || startY === null) return;
      const dy = event.touches[0].clientY - startY;
      if (dy <= 0) {
        setDistance(0);
        return;
      }
      if (window.scrollY > 0) {
        tracking = false;
        setDistance(0);
        return;
      }
      // Keep the page still while the indicator follows the finger.
      event.preventDefault();
      setDistance(Math.min(MAX, dy * 0.55));
    };

    const finish = () => {
      if (!tracking) return;
      tracking = false;
      startY = null;
      const distance = pullValue.current;
      setDistance(0);
      if (distance >= THRESHOLD) void refreshRef.current();
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', finish);
    window.addEventListener('touchcancel', finish);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', finish);
      window.removeEventListener('touchcancel', finish);
    };
  }, []);

  return (
    <div className="app">
      {(pull > 0 || refreshing) && (
        <div className="pull" role="status" aria-live="polite">
          {refreshing ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <span className="pull__arrow" aria-hidden="true">
              ↓
            </span>
          )}
          {refreshing
            ? 'Refreshing…'
            : pull >= 64
              ? 'Release to refresh'
              : 'Pull to refresh'}
        </div>
      )}

      <header className="topbar">
        <div className="topbar__row">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <h1>Market structure</h1>
          </div>

          {indexPicker('topbar__index')}

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
              {theme === 'dark' ? (
                <svg
                  className="icon"
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="8" cy="8" r="3.1" />
                  <path d="M8 1.4v1.3M8 13.3v1.3M1.4 8h1.3M13.3 8h1.3M3.3 3.3l.9.9M11.8 11.8l.9.9M12.7 3.3l-.9.9M4.2 11.8l-.9.9" />
                </svg>
              ) : (
                <svg
                  className="icon"
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M13.4 10.3A5.6 5.6 0 0 1 5.7 2.6a5.7 5.7 0 1 0 7.7 7.7Z" />
                </svg>
              )}
            </button>
            <button
              className="btn btn--ghost btn--backtest"
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
              className="btn btn--ghost btn--refresh"
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
              {indexPicker('controls__index')}

              <ChipGroup
                className="controls__chips"
                label="Swing method"
                value={method}
                onChange={setMethod}
                options={METHOD_OPTIONS}
              />

              <ChipGroup
                className="controls__chips"
                label="Timeframe"
                value={timeframe}
                onChange={setTimeframe}
                options={TIMEFRAME_OPTIONS}
              />

              <ChipGroup
                className="controls__chips"
                label="Confirmation"
                value={confirmation}
                onChange={setConfirmation}
                options={CONFIRMATION_OPTIONS}
              />

              <select
                className="controls__select controls__select--desktop"
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
                className="controls__select controls__select--desktop"
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

              <button
                className="controls__filters"
                onClick={() => setSheet('filters')}
                aria-haspopup="dialog"
                aria-expanded={sheet === 'filters'}
              >
                <span>Filters</span>
                <span className="controls__filters-sum" aria-hidden="true">
                  {method === 'fractal' ? 'Fractal' : 'ATR'} ·{' '}
                  {TIMEFRAME_LABEL[timeframe]} · {confirmation} candle
                  {confirmation === 2 ? 's' : ''}
                </span>
              </button>

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
                onChart={handleSelectChart}
              />
            )}

            <footer className="panel__foot">
              <span>
                Detection: 3 years ·{' '}
                {method === 'fractal'
                  ? 'fractal k=2'
                  : 'ATR 14 · 2× zigzag'}{' '}
                · close beyond confirmed swing · 1 or 2 candle confirmation.
                Chart view: 6 months.
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
                A shift is confirmed when a close crosses the latest confirmed{' '}
                {method === 'fractal'
                  ? 'fractal swing (k=2)'
                  : 'ATR zigzag swing (14, 2×)'}
                . With 2-candle confirmation, the level must be closed beyond
                twice, and only levels already confirmed at the first close
                count.
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
              {snapshot.indices.length} primary indices · {datasets.length} of{' '}
              {catalogue.length} loaded · snapshot {snapshot.version}
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
        startFull={chartOnly}
        onClearFocus={() => setInspectTrade(null)}
        onClose={() => {
          setSelected(null);
          setChartOnly(false);
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

      <nav className="dock" aria-label="Table controls">
        <button
          className="dock__btn"
          onClick={() => setSheet('filters')}
          aria-haspopup="dialog"
          aria-expanded={sheet === 'filters'}
        >
          <span className="dock__label">Filters</span>
          <span className="dock__value">
            {method === 'fractal' ? 'Fractal' : 'ATR'} ·{' '}
            {TIMEFRAME_SHORT[timeframe]} · {confirmation}c
            {direction === 'all'
              ? ''
              : ` · ${direction === 'bullish' ? 'Bull' : 'Bear'}`}
          </span>
        </button>

        <button
          className="dock__btn"
          onClick={() => setSheet('sort')}
          aria-haspopup="dialog"
          aria-expanded={sheet === 'sort'}
        >
          <span className="dock__label">Sort</span>
          <span className="dock__value">
            {SORT_SHORT[sort.key]} {sort.dir === 'asc' ? '↑' : '↓'}
          </span>
        </button>
      </nav>

      {sheet && (
        <div className="sheet-layer" role="presentation">
          <button
            className="sheet-backdrop"
            aria-label={sheet === 'sort' ? 'Close sort' : 'Close filters'}
            onClick={() => setSheet(null)}
          />
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={sheet === 'sort' ? 'Sort' : 'Filters'}
          >
            <header className="sheet__head">
              <strong>{sheet === 'sort' ? 'Sort by' : 'Filters'}</strong>
              <button
                className="icon-btn"
                onClick={() => setSheet(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            {sheet === 'sort' ? (
              <div className="sheet__options" role="group" aria-label="Sort">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    className={sort.key === option.key ? 'is-active' : ''}
                    onClick={() => handleSortSelect(option.key)}
                  >
                    {option.label}
                    {sort.key === option.key
                      ? sort.dir === 'asc'
                        ? ' ↑'
                        : ' ↓'
                      : ''}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="sheet__group">
                  <span className="sheet__label">Swing method</span>
                  <ChipGroup
                    className="sheet__seg"
                    label="Swing method"
                    value={method}
                    onChange={setMethod}
                    options={METHOD_OPTIONS}
                  />
                </div>

                <div className="sheet__group">
                  <span className="sheet__label">Timeframe</span>
                  <ChipGroup
                    className="sheet__seg"
                    label="Timeframe"
                    value={timeframe}
                    onChange={setTimeframe}
                    options={TIMEFRAME_OPTIONS}
                  />
                </div>

                <div className="sheet__group">
                  <span className="sheet__label">Confirmation</span>
                  <ChipGroup
                    className="sheet__seg"
                    label="Confirmation"
                    value={confirmation}
                    onChange={setConfirmation}
                    options={CONFIRMATION_OPTIONS}
                  />
                </div>

                <div className="sheet__group">
                  <span className="sheet__label">Direction</span>
                  <div
                    className="segmented sheet__seg"
                    role="group"
                    aria-label="Direction"
                  >
                    {(
                      [
                        ['all', 'All shifts'],
                        ['bullish', 'Bullish'],
                        ['bearish', 'Bearish'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        className={direction === value ? 'is-active' : ''}
                        onClick={() => setDirection(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sheet__group sheet__sort">
                  <span className="sheet__label">Sort by</span>
                  <div className="sheet__options" role="group" aria-label="Sort">
                    {SORT_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        className={sort.key === option.key ? 'is-active' : ''}
                        onClick={() => handleSortSelect(option.key)}
                      >
                        {option.label}
                        {sort.key === option.key
                          ? sort.dir === 'asc'
                            ? ' ↑'
                            : ' ↓'
                          : ''}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <button
              className="btn btn--primary sheet__done"
              onClick={() => setSheet(null)}
            >
              Done
            </button>
          </section>
        </div>
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
