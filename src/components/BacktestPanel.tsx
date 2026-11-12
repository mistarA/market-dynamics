import { useEffect, useMemo, useState } from 'react';
import { BREAKEVEN_WIN_RATE, EXCLUDED_SYMBOLS } from '../lib/backtest';
import { formatDate } from '../lib/date';
import { formatPrice } from '../lib/format';
import type {
  BacktestEquityPoint,
  BacktestReport,
  BacktestScope,
  BacktestScopeKey,
  BacktestSetupResult,
  BacktestStats,
  BacktestTrade,
  Snapshot,
  SwingMethod,
} from '../lib/types';
import type { AnalysisClient } from '../lib/workerClient';

type Props = {
  open: boolean;
  snapshot: Snapshot;
  client: AnalysisClient | null;
  workerReady: boolean;
  provisional: boolean;
  onClose: () => void;
  onInspectTrade: (
    method: SwingMethod,
    trade: BacktestTrade,
    indexKey: string,
  ) => void;
};

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function rValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`;
}

function number(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function symbolWord(count: number): string {
  return count === 1 ? 'symbol' : 'symbols';
}

function breakevenWinRate(stats: BacktestStats): string {
  if (stats.avgWinR === null || stats.avgLossR === null) return '—';
  const loss = Math.abs(stats.avgLossR);
  if (stats.avgWinR + loss <= 0) return '—';
  return pct(loss / (stats.avgWinR + loss));
}

function equityPath(
  points: BacktestEquityPoint[],
  min: number,
  max: number,
  minTime: number,
  maxTime: number,
): string {
  if (points.length === 0) return '';
  const height = 40;
  const span = max - min || 1;
  const timeSpan = Math.max(maxTime - minTime, 86_400_000);
  const y = (value: number) => height - ((value - min) / span) * height;
  const startDate = new Date(minTime).toISOString().slice(0, 10);
  const series = [{ d: startDate, r: 0 }, ...points];
  return series
    .map((point, index) => {
      const time = Date.parse(`${point.d}T00:00:00Z`);
      const x = ((time - minTime) / timeSpan) * 100;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y(point.r).toFixed(2)}`;
    })
    .join(' ');
}

function EquityChart({ fractal, atr }: { fractal: BacktestSetupResult; atr: BacktestSetupResult }) {
  const all = [...fractal.equity, ...atr.equity];
  if (all.length < 2) {
    return <p className="muted bt-empty-chart">Not enough resolved trades to plot equity.</p>;
  }
  const values = all.map((point) => point.r);
  const times = all
    .map((point) => Date.parse(`${point.d}T00:00:00Z`))
    .filter((time) => Number.isFinite(time));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const zero = 40 - ((0 - min) / (max - min || 1)) * 40;

  return (
    <div className="bt-chart">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Cumulative R over time">
        <line x1="0" y1={zero} x2="100" y2={zero} className="bt-chart__zero" />
        {fractal.equity.length > 1 && (
          <path
            d={equityPath(fractal.equity, min, max, minTime, maxTime)}
            className="bt-chart__line bt-chart__line--fractal"
          />
        )}
        {atr.equity.length > 1 && (
          <path
            d={equityPath(atr.equity, min, max, minTime, maxTime)}
            className="bt-chart__line bt-chart__line--atr"
          />
        )}
      </svg>
      <div className="bt-chart__legend">
        <span><i className="bt-swatch bt-swatch--fractal" />Fractal {rValue(fractal.stats.totalR)}</span>
        <span><i className="bt-swatch bt-swatch--atr" />ATR {rValue(atr.stats.totalR)}</span>
        <span className="muted">Cumulative R on a shared date axis</span>
      </div>
    </div>
  );
}

function winRateCell(stats: BacktestStats): string {
  if (stats.winRate === null) return '—';
  if (stats.ambiguous === 0) return pct(stats.winRate);
  return `${pct(stats.winRate)} (${pct(stats.winRateLower)} – ${pct(stats.winRateUpper)})`;
}

const METRIC_ROWS: {
  label: string;
  value: (stats: BacktestStats) => string;
  hint?: string;
}[] = [
  { label: 'Signals', value: (s) => String(s.trades), hint: 'Entries taken' },
  { label: 'Resolved', value: (s) => String(s.wins + s.losses + s.scratches) },
  { label: 'Wins / losses', value: (s) => `${s.wins} / ${s.losses}` },
  { label: 'Win rate', value: winRateCell, hint: 'Ambiguous bars give the lower–upper band' },
  { label: 'Avg win', value: (s) => rValue(s.avgWinR) },
  { label: 'Avg loss', value: (s) => rValue(s.avgLossR) },
  { label: 'Expectancy', value: (s) => rValue(s.expectancyR), hint: 'Resolved trades' },
  { label: 'Profit factor', value: (s) => number(s.profitFactor) },
  {
    label: 'Breakeven win rate',
    value: breakevenWinRate,
    hint: 'From realized average win and loss',
  },
  { label: 'Max drawdown', value: (s) => rValue(-s.maxDrawdownR) },
  { label: 'Target hits', value: (s) => String(s.targetHits) },
  { label: 'Stop hits', value: (s) => String(s.stopHits) },
  { label: 'Flip exits', value: (s) => String(s.flipExits) },
  { label: 'Ambiguous', value: (s) => String(s.ambiguous) },
  { label: 'Open at end', value: (s) => String(s.open) },
  { label: 'Skipped', value: (s) => String(s.skipped), hint: 'No active swing, or open beyond the stop' },
  { label: 'Avg stop', value: (s) => (s.avgRiskPct === null ? '—' : `${s.avgRiskPct.toFixed(2)}%`) },
  { label: 'Avg hold', value: (s) => (s.avgBarsHeld === null ? '—' : `${s.avgBarsHeld.toFixed(1)} bars`) },
  {
    label: 'Avg MFE',
    value: (s) => rValue(s.avgMfeR),
    hint: 'Best unrealized R before the exit',
  },
  {
    label: 'Avg MAE',
    value: (s) => rValue(s.avgMaeR),
    hint: 'Worst unrealized R while held',
  },
  {
    label: 'Losses under +0.5R',
    value: (s) => `${s.lossesUnderHalfR} / ${s.losses}`,
    hint: 'Losses that never showed 0.5R of profit',
  },
  {
    label: 'Wins after −0.5R',
    value: (s) => `${s.winsAfterHalfR} / ${s.wins}`,
    hint: 'Wins that first drew down at least 0.5R',
  },
];

function ScopeTable({ scope }: { scope: BacktestScope }) {
  return (
    <div className="bt-compare">
      <div className="bt-compare__head">
        <div>
          <h3>A/B result</h3>
          <p className="muted">
            Same MSS flip entries; only the swing detector and its stop level change.
          </p>
        </div>
        <span className="bt-compare__sample">{scope.symbols} {symbolWord(scope.symbols)}</span>
      </div>
      <div className="bt-table-wrap">
        <table className="bt-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th className="num">Fractal k=2</th>
              <th className="num">ATR 14 · 2×</th>
            </tr>
          </thead>
          <tbody>
            {METRIC_ROWS.map((row) => (
              <tr key={row.label}>
                <td>
                  {row.label}
                  {row.hint && <span className="bt-hint">{row.hint}</span>}
                </td>
                <td className="num">{row.value(scope.fractal.stats)}</td>
                <td className="num">{row.value(scope.atr.stats)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TradeTable({
  setup,
  onInspect,
}: {
  setup: BacktestSetupResult;
  onInspect: (trade: BacktestTrade) => void;
}) {
  const trades = setup.trades.slice(-200).reverse();
  if (trades.length === 0) {
    return <p className="muted">No trades in this setup.</p>;
  }
  return (
    <div className="bt-trades-wrap">
      <table className="bt-trades">
        <thead>
          <tr>
            <th>Entry</th>
            <th>Side</th>
            <th className="num">Entry</th>
            <th className="num">Stop</th>
            <th className="num">Target</th>
            <th>Exit</th>
            <th>Reason</th>
            <th className="num">R</th>
            <th className="num">MFE</th>
            <th className="num">MAE</th>
            <th className="num">Bars</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {trades.map((trade: BacktestTrade) => (
            <tr key={`${trade.entryDate}-${trade.direction}-${trade.entryIdx}`}>
              <td className="num">{formatDate(trade.entryDate)}</td>
              <td>
                <span className={`pill pill--${trade.direction}`}>
                  {trade.direction === 'bullish' ? 'Long' : 'Short'}
                </span>
              </td>
              <td className="num">{formatPrice(trade.entry)}</td>
              <td className="num">{formatPrice(trade.stop)}</td>
              <td className="num">{formatPrice(trade.target)}</td>
              <td className="num">{trade.exitDate ? formatDate(trade.exitDate) : '—'}</td>
              <td>
                <span className={`bt-reason bt-reason--${trade.exitReason}`}>
                  {trade.exitReason}
                </span>
              </td>
              <td className={`num ${trade.r === null ? 'flat' : trade.r > 0 ? 'up' : trade.r < 0 ? 'down' : 'flat'}`}>
                {trade.r === null ? '—' : rValue(trade.r)}
              </td>
              <td className="num muted">{rValue(trade.mfeR)}</td>
              <td className="num muted">{rValue(trade.maeR)}</td>
              <td className="num">{trade.barsHeld ?? '—'}</td>
              <td className="bt-trades__action">
                <button
                  type="button"
                  className="bt-inspect"
                  onClick={() => onInspect(trade)}
                  title="Show this trade on the price chart"
                >
                  Chart
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BacktestPanel({
  open,
  snapshot,
  client,
  workerReady,
  provisional,
  onClose,
  onInspectTrade,
}: Props) {
  const [indexKey, setIndexKey] = useState(
    snapshot.indices[0]?.key ?? '',
  );
  const [query, setQuery] = useState('');
  const [symbol, setSymbol] = useState<string | null>(null);
  const [costs, setCosts] = useState('0');
  const [running, setRunning] = useState(false);
  const [runtimeMs, setRuntimeMs] = useState<number | null>(null);
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scopeKey, setScopeKey] = useState<BacktestScopeKey>('stock');

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    setReport(null);
    setError(null);
    setRuntimeMs(null);
    setSymbol(null);
    setQuery('');
    setScopeKey('stock');
    setIndexKey((current) =>
      snapshot.indices.some((item) => item.key === current)
        ? current
        : snapshot.indices[0]?.key ?? '',
    );
  }, [snapshot.version, snapshot.indices]);

  const index = useMemo(
    () => snapshot.indices.find((item) => item.key === indexKey) ?? snapshot.indices[0] ?? null,
    [snapshot.indices, indexKey],
  );

  const stocks = useMemo(() => {
    if (!index) return [];
    const needle = query.trim().toUpperCase();
    return index.symbols
      .filter((item) => !EXCLUDED_SYMBOLS.has(item))
      .filter((item) => {
        if (!needle) return true;
        const meta = snapshot.symbols[item];
        return (
          item.includes(needle) ||
          (meta?.name ?? '').toUpperCase().includes(needle)
        );
      })
      .sort((a, b) => a.localeCompare(b));
  }, [index, query, snapshot.symbols]);

  const activeScope = useMemo(
    () => report?.scopes.find((scope) => scope.key === scopeKey) ?? report?.scopes[0] ?? null,
    [report, scopeKey],
  );

  const excludedInIndex = useMemo(
    () => (index ? index.symbols.filter((item) => EXCLUDED_SYMBOLS.has(item)) : []),
    [index],
  );

  if (!open) return null;

  const handleIndex = (key: string) => {
    setIndexKey(key);
    setSymbol(null);
    setQuery('');
    setReport(null);
    setError(null);
    setRuntimeMs(null);
    setScopeKey('stock');
  };

  const handleSymbol = (next: string) => {
    setSymbol(next);
    setReport(null);
    setError(null);
    setRuntimeMs(null);
  };

  const handleRun = async () => {
    if (!client || !symbol || running || !workerReady) return;
    setRunning(true);
    setError(null);
    const started = performance.now();
    try {
      const result = await client.backtest(
        indexKey,
        symbol,
        Math.max(0, Number(costs) || 0),
        provisional,
      );
      setReport(result.report);
      setRuntimeMs(result.computeMs ?? performance.now() - started);
      setScopeKey('stock');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Backtest failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bt-layer" role="presentation">
      <button className="bt-backdrop" aria-label="Close backtest" onClick={onClose} />
      <section
        className="bt"
        role="dialog"
        aria-modal="true"
        aria-label="Backtest fractal vs ATR"
      >
        <header className="bt__head">
          <div>
            <div className="bt__eyebrow">Runtime backtest · daily bars · 2R target</div>
            <h2>Fractal vs ATR</h2>
            <p className="muted">
              MSS flip entries (1-candle confirmation), next-open fills, structural
              stops. Choose an index and a stock, then press Run.
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="bt__body">
          <section className="bt-controls">
            <label className="bt-field">
              <span>Index</span>
              <select value={indexKey} onChange={(event) => handleIndex(event.target.value)}>
                {snapshot.indices.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="bt-field bt-field--stock">
              <span>Stock</span>
              <input
                type="search"
                value={query}
                placeholder="Search this index"
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="bt-picker" role="listbox" aria-label="Stock">
                {stocks.map((item) => {
                  const meta = snapshot.symbols[item];
                  return (
                    <button
                      key={item}
                      type="button"
                      role="option"
                      aria-selected={symbol === item}
                      className={symbol === item ? 'is-active' : ''}
                      onClick={() => handleSymbol(item)}
                    >
                      <strong>{item}</strong>
                      <span>{meta?.name ?? ''}</span>
                    </button>
                  );
                })}
                {stocks.length === 0 && (
                  <p className="bt-picker__empty">No stock matches.</p>
                )}
              </div>
            </div>

            <div className="bt-field bt-field--run">
              <span>Run</span>
              <button
                className="btn btn--primary bt-run"
                onClick={() => void handleRun()}
                disabled={!symbol || running || !workerReady || !client}
                title={symbol ? `Backtest ${symbol}` : 'Choose a stock first'}
              >
                {running ? <span className="spinner" /> : null}
                {running ? 'Running…' : 'Run backtest'}
              </button>
              <small className="muted">
                {symbol ? `${symbol} selected` : 'A stock is required'}
              </small>
            </div>

            <details className="bt-advanced">
              <summary>Advanced</summary>
              <label>
                Costs per side (bps)
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={costs}
                  onChange={(event) => {
                    setCosts(event.target.value);
                    setReport(null);
                    setError(null);
                  }}
                />
              </label>
              <p className="muted">
                0 bps = gross. 10 bps per side ≈ 0.20% round trip. Changing this
                clears the current result.
              </p>
            </details>
          </section>

          {excludedInIndex.length > 0 && (
            <p className="bt-excluded">
              Excluded from every scope: {excludedInIndex.join(', ')} — unadjusted
              demerger gaps in the raw NSE series.
            </p>
          )}

          {error && <p className="bt-error">{error}</p>}

          {!report && !error && (
            <div className="bt-placeholder">
              <p>
                {symbol
                  ? `Ready to backtest ${symbol}. Press Run.`
                  : 'Choose an index and a stock, then press Run.'}
              </p>
              <p className="muted">
                Each scope runs both setups: fractal k=2 with the fractal swing stop,
                and ATR(14, 2×) with the ATR swing stop. Results are computed on demand;
                nothing is cached between runs.
              </p>
            </div>
          )}

          {report && (
            <>
              {report.warnings.length > 0 && (
                <ul className="bt-warnings">
                  {report.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              <nav className="bt-scopes" aria-label="Result scope">
                {report.scopes.map((scope) => (
                  <button
                    key={scope.key}
                    className={scope.key === scopeKey ? 'is-active' : ''}
                    onClick={() => setScopeKey(scope.key)}
                  >
                    <span>
                      {scope.key === 'stock'
                        ? `Selected stock · ${report.symbol}`
                        : scope.key === 'index'
                          ? `Selected index · ${report.indexName}`
                          : 'All core'}
                    </span>
                    <small>{scope.symbols} {symbolWord(scope.symbols)}</small>
                  </button>
                ))}
              </nav>

              {activeScope && (
                <>
                  <ScopeTable scope={activeScope} />

                  <section className="bt-equity">
                    <div className="bt-equity__head">
                      <h3>Equity curve</h3>
                      <span className="muted">
                        {provisional ? 'Provisional bar excluded' : 'Final bars only'} ·{' '}
                        {report.costsBps} bps/side ·{' '}
                        {runtimeMs === null ? '' : `${Math.round(runtimeMs)} ms`}
                      </span>
                    </div>
                    <EquityChart fractal={activeScope.fractal} atr={activeScope.atr} />
                  </section>

                  <section className="bt-trade-section">
                    <div className="bt-trade-head">
                      <h3>Trade list</h3>
                      <span className="muted">
                        {activeScope.key === 'stock'
                          ? `${activeScope.fractal.trades.length} fractal · ${activeScope.atr.trades.length} ATR (latest first) · Chart opens the trade on the price chart`
                          : 'Select the stock scope to inspect individual trades.'}
                      </span>
                    </div>
                    {activeScope.key === 'stock' ? (
                      <div className="bt-trade-cols">
                        <div>
                          <h4>Fractal k=2</h4>
                          <TradeTable
                            setup={activeScope.fractal}
                            onInspect={(trade) =>
                              onInspectTrade('fractal', trade, indexKey)
                            }
                          />
                        </div>
                        <div>
                          <h4>ATR 14 · 2×</h4>
                          <TradeTable
                            setup={activeScope.atr}
                            onInspect={(trade) =>
                              onInspectTrade('atr', trade, indexKey)
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                  </section>
                </>
              )}

              <footer className="bt-foot">
                <span>
                  A pure 2R/1R book breaks even at {(BREAKEVEN_WIN_RATE * 100).toFixed(1)}%
                  before costs; flip exits change the realized mix.
                </span>
                <span>
                  Data: NSE daily bars {formatDate(report.from)} – {formatDate(report.to)} ·{' '}
                  {report.scopes[2]?.symbols ?? 0} core symbols · survivorship bias applies.
                </span>
              </footer>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
