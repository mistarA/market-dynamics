import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type AutoscaleInfo,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { runSetup } from '../lib/backtest';
import { formatDate, TIMEFRAME_LABEL } from '../lib/date';
import { formatPct, formatPrice } from '../lib/format';
import { computeStructure } from '../lib/mss';
import { findPivots } from '../lib/pivots';
import { ATR_PERIOD, EXTERNAL_ATR_MULTIPLE, findZigzagPivots } from '../lib/swings';
import type {
  BacktestTrade,
  Confirmation,
  Detail,
  Direction,
  Row,
  SwingMethod,
} from '../lib/types';

type TradeMode = 'off' | SwingMethod;

/** Browse overlays are paused while the dashboard is being reviewed. */
const SHOW_TRADE_OVERLAY = false;

export type FocusTrade = {
  method: SwingMethod;
  symbol: string;
  entryDate: string;
  direction: Direction;
};

const METHOD_COLOR: Record<SwingMethod, string> = {
  fractal: '#1d7a6c',
  atr: '#b98a2c',
};
const SETUP_LABEL: Record<SwingMethod, string> = {
  fractal: 'Fractal k=2',
  atr: 'ATR 14 · 2×',
};

const EXIT_COLOR: Record<BacktestTrade['exitReason'], string> = {
  target: '#1d7a6c',
  stop: '#c0482d',
  flip: '#b98a2c',
  ambiguous: '#b98a2c',
  open: '#7a7164',
};

function rValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`;
}

function reasonText(trade: BacktestTrade, method: SwingMethod): string {
  const entry =
    `${SETUP_LABEL[method]} flip on ${formatDate(trade.signalDate)} at ` +
    `${formatPrice(trade.signalLevel)}, entered at the next open ` +
    `(${formatPrice(trade.entry)}).`;
  const ran = `${rValue(trade.mfeR)} best, ${rValue(trade.maeR)} worst while held.`;
  switch (trade.exitReason) {
    case 'target':
      return `${entry} The 2R target was reached on ${formatDate(trade.exitDate)}. ${ran}`;
    case 'stop':
      return `${entry} The frozen swing stop was hit on ${formatDate(trade.exitDate)}. ${ran}`;
    case 'flip':
      return `${entry} An opposite MSS flip closed the trade at the next open on ${formatDate(trade.exitDate)}, and the reverse trade opened there. ${ran}`;
    case 'ambiguous':
      return `${entry} This bar touched both the stop and the 2R target. Daily data cannot tell which came first, so the trade is excluded from the win rate.`;
    case 'open':
      return `${entry} Still open at the end of the series. It is excluded from the win/loss counts.`;
    default:
      return entry;
  }
}

function nearestTrade(
  trades: BacktestTrade[],
  date: string,
): number {
  if (!trades.length) return 0;
  const target = Date.parse(date);
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  trades.forEach((trade, index) => {
    const delta = Math.abs(Date.parse(trade.entryDate) - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = index;
    }
  });
  return best;
}

type Props = {
  row: Row | null;
  detail: Detail | null;
  loading: boolean;
  theme: 'dark' | 'light';
  focus: FocusTrade | null;
  /** Opened from a card's chart button: show the chart before the drawer. */
  startFull?: boolean;
  onClearFocus: () => void;
  onClose: () => void;
};

export function DetailDrawer({
  row,
  detail,
  loading,
  theme,
  focus,
  startFull = false,
  onClearFocus,
  onClose,
}: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [tradeMode, setTradeMode] = useState<TradeMode>('off');
  const [focusIndex, setFocusIndex] = useState(0);
  /** Chart fills the viewport until the user exits or picks another symbol. */
  const [chartFull, setChartFull] = useState(false);
  /**
   * The root dashboard toggle sets the default method. The chip in the chart
   * overrides it for this symbol only; opening another symbol resets it.
   */
  const [chartOverride, setChartOverride] = useState<SwingMethod | null>(null);
  const chartMethod: SwingMethod =
    chartOverride ?? detail?.method ?? 'fractal';
  /** Confirmation candles can be overridden here without touching the root. */
  const [confirmationOverride, setConfirmationOverride] =
    useState<Confirmation | null>(null);
  const chartConfirmation: Confirmation =
    confirmationOverride ?? detail?.confirmation ?? 1;

  /**
   * External swings are found on the same confirmed bars as MSS: when today is
   * still forming, the final bar is excluded from confirmation.
   */
  const detectionBars = useMemo(() => {
    if (!detail) return [];
    return detail.provisional ? detail.bars.slice(0, -1) : detail.bars;
  }, [detail]);

  /**
   * Backtest trades are daily-bar only. Recompute them here for the inspected
   * symbol so the chart can show the exact entries, stops and exits.
   */
  const trades = useMemo(() => {
    if (!detail || detail.timeframe !== 'day' || detail.bars.length < 3) {
      return null;
    }
    const bars = detail.provisional ? detail.bars.slice(0, -1) : detail.bars;
    return {
      fractal: runSetup(detail.symbol, bars, { method: 'fractal' }).trades,
      atr: runSetup(detail.symbol, bars, { method: 'atr' }).trades,
    };
  }, [detail]);

  /**
   * The chart always reflects the selected algorithm: same pivots, same
   * confirmation, same MSS flips, and the stop swing of the latest flip.
   */
  const chartStructure = useMemo(() => {
    if (!detail || detectionBars.length < 3) return null;
    const pivots =
      chartMethod === 'fractal'
        ? findPivots(detectionBars, 2)
        : findZigzagPivots(
            detectionBars,
            EXTERNAL_ATR_MULTIPLE,
            ATR_PERIOD,
          );
    return computeStructure(detail.bars, {
      confirmation: chartConfirmation,
      dropLast: detail.provisional,
      pivots,
    });
  }, [detail, detectionBars, chartMethod, chartConfirmation]);

  const activeMethod: SwingMethod = chartMethod;
  const focusTrades = trades ? trades[activeMethod] : [];

  useEffect(() => {
    setChartOverride(null);
    setConfirmationOverride(null);
  }, [detail?.symbol]);

  /** Keep the dashboard still behind the drawer, especially on touch screens. */
  useEffect(() => {
    if (!row) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [row]);

  useEffect(() => {
    if (!focus || !trades) return;
    setChartOverride(focus.method);
    setFocusIndex(
      Math.max(
        0,
        trades[focus.method].findIndex(
          (trade) =>
            trade.entryDate === focus.entryDate &&
            trade.direction === focus.direction,
        ),
      ),
    );
    setTradeMode(focus.method);
  }, [focus, trades]);

  useEffect(() => {
    if (!focus) {
      setChartOverride(null);
      setFocusIndex(0);
    }
  }, [focus]);

  const focused =
    focus &&
    detail &&
    focus.symbol === detail.symbol &&
    focusTrades.length > 0
      ? focusTrades[Math.min(focusIndex, focusTrades.length - 1)]
      : null;

  const stepFocus = (delta: number) => {
    setFocusIndex((current) =>
      Math.min(Math.max(0, current + delta), focusTrades.length - 1),
    );
  };

  const switchMethod = (next: SwingMethod) => {
    if (!trades || !focused || next === activeMethod) return;
    const list = trades[next];
    if (!list.length) return;
    setFocusIndex(nearestTrade(list, focused.entryDate));
    setChartOverride(next);
    setTradeMode(next);
  };

  /** Chart chip: override the root method for this drawer. */
  const setChartMethod = (next: SwingMethod) => {
    if (next === chartMethod) return;
    if (focused) switchMethod(next);
    setChartOverride(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Escape leaves the full-screen chart before it closes the drawer.
      if (chartFull) {
        if (startFull) {
          onClose();
          return;
        }
        setChartFull(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, chartFull, startFull]);

  // A chart button opens straight into full screen; any other row opens the drawer.
  useEffect(() => {
    setChartFull(startFull);
  }, [row?.symbol, startFull]);

  useEffect(() => {
    const container = chartRef.current;
    if (!detail || !container || detail.bars.length === 0) return;

    const light = theme === 'light';
    const textColor = light ? '#7a7164' : '#9b9181';
    const gridLine = light ? 'rgba(28,25,21,0.06)' : 'rgba(236,228,210,0.05)';
    const axisLine = light ? '#d9cfbc' : '#38322a';
    const labelBg = light ? '#ece4d2' : '#25211b';
    const crosshair = light ? 'rgba(29,122,108,0.45)' : 'rgba(63,184,162,0.45)';
    const upColor = light ? '#1d7a6c' : '#3fb8a2';
    const downColor = light ? '#c0482d' : '#e0694a';

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: gridLine },
        horzLines: { color: gridLine },
      },
      rightPriceScale: {
        borderColor: axisLine,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderColor: axisLine,
        rightOffset: 4,
        barSpacing: 7,
        fixLeftEdge: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: crosshair, labelBackgroundColor: labelBg },
        horzLine: { color: crosshair, labelBackgroundColor: labelBg },
      },
    });

    const series = chart.addCandlestickSeries({
      upColor,
      downColor,
      borderVisible: false,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });

    series.setData(
      detail.bars.map((bar) => ({
        time: bar.d as Time,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
      })),
    );

    const markers: SeriesMarker<Time>[] = [];
    const events = chartStructure?.events ?? detail.events;
    const eventLabel = chartMethod === 'atr' ? 'ATR MSS' : 'MSS';
    for (const event of events) {
      markers.push({
        time: event.date as Time,
        position: event.direction === 'bullish' ? 'belowBar' : 'aboveBar',
        color: event.direction === 'bullish' ? upColor : downColor,
        shape: event.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
        text: eventLabel,
        size: 1.2,
      });
    }

    // Only the swing that backs the stop of the latest flip is marked: a low
    // for bullish structure, a high for bearish structure.
    const lastEvent = chartStructure?.lastEvent ?? null;
    const slLevel = lastEvent?.stopLevel ?? null;
    const slDate = lastEvent?.stopDate ?? null;
    const slBullish = lastEvent?.direction === 'bullish';
    const slColor = slBullish ? upColor : downColor;
    if (!focused && slLevel !== null && slDate) {
      markers.push({
        time: slDate as Time,
        position: slBullish ? 'belowBar' : 'aboveBar',
        color: slColor,
        shape: 'circle',
        text: 'SL',
        size: 1,
      });
    }

    if (focused) {
      // Entry and exit for the inspected trade, labelled with prices.
      markers.push({
        time: focused.entryDate as Time,
        position: focused.direction === 'bullish' ? 'belowBar' : 'aboveBar',
        color: METHOD_COLOR[activeMethod],
        shape: focused.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
        text: `${focused.direction === 'bullish' ? 'LONG' : 'SHORT'} ${formatPrice(focused.entry)}`,
        size: 1.4,
      });
      if (focused.exitDate) {
        markers.push({
          time: focused.exitDate as Time,
          position: focused.direction === 'bullish' ? 'aboveBar' : 'belowBar',
          color: EXIT_COLOR[focused.exitReason],
          shape: 'square',
          text:
            focused.r === null
              ? focused.exitReason.toUpperCase()
              : `${rValue(focused.r)} ${focused.exitReason.toUpperCase()}`,
          size: 1.2,
        });
      }
    } else if (SHOW_TRADE_OVERLAY && tradeMode !== 'off' && trades) {
      // Browse mode: every entry and resolved exit for the selected setup.
      for (const trade of trades[tradeMode].slice(-60)) {
        markers.push({
          time: trade.entryDate as Time,
          position: trade.direction === 'bullish' ? 'belowBar' : 'aboveBar',
          color: METHOD_COLOR[tradeMode],
          shape: trade.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
          size: 0.9,
        });
        if (trade.exitDate) {
          markers.push({
            time: trade.exitDate as Time,
            position: trade.direction === 'bullish' ? 'aboveBar' : 'belowBar',
            color: EXIT_COLOR[trade.exitReason],
            shape: 'circle',
            size: 0.7,
          });
        }
      }
    }

    markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    series.setMarkers(markers);

    if (focused) {
      // Keep the target visible even when price never reached it.
      const low = Math.min(focused.stop, focused.entry, focused.target);
      const high = Math.max(focused.stop, focused.entry, focused.target);
      series.applyOptions({
        autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
          const base = original();
          if (!base) {
            return {
              priceRange: { minValue: low, maxValue: high },
              margins: { above: 10, below: 10 },
            };
          }
          return {
            ...base,
            priceRange: {
              minValue: Math.min(base.priceRange.minValue, low),
              maxValue: Math.max(base.priceRange.maxValue, high),
            },
          };
        },
      });

      series.createPriceLine({
        price: focused.entry,
        color: METHOD_COLOR[activeMethod],
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: 'entry',
      });
      series.createPriceLine({
        price: focused.stop,
        color: downColor,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'stop',
      });
      series.createPriceLine({
        price: focused.target,
        color: upColor,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '2R target',
      });
    } else if (slLevel !== null) {
      series.createPriceLine({
        price: slLevel,
        color: slColor,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'SL',
      });
    }

    if (focused) {
      const exitIdx = focused.exitIdx ?? focused.entryIdx;
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, focused.entryIdx - 28),
        to: Math.min(detail.bars.length + 1, Math.max(focused.entryIdx + 14, exitIdx + 14)),
      });
    } else {
      const view =
        detail.timeframe === 'day' ? 126 : detail.timeframe === 'week' ? 26 : 7;
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, detail.bars.length - view),
        to: detail.bars.length + 1,
      });
    }

    return () => {
      chart.remove();
    };
  }, [
    detail,
    theme,
    chartStructure,
    chartMethod,
    trades,
    tradeMode,
    focus,
    focused,
    activeMethod,
    // Re-render the chart at the new size so the bars fill the canvas.
    chartFull,
  ]);

  if (!row) return null;

  const shown = chartStructure ?? detail;
  const recentEvents = shown ? [...shown.events].slice(-8).reverse() : [];
  const currentEvent = shown?.lastEvent ?? null;
  const currentBarsSince = shown?.barsSince ?? null;
  const currentHigh = shown?.activeHigh ?? null;
  const currentLow = shown?.activeLow ?? null;
  const focusPosition =
    focusTrades.length === 0 ? 0 : Math.min(focusIndex + 1, focusTrades.length);

  return (
    <div className="drawer-layer" role="presentation">
      <button
        className="drawer-backdrop"
        aria-label="Close details"
        onClick={onClose}
      />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${row.symbol} structure detail`}
      >
        <header className="drawer__head">
          <div>
            <div className="drawer__eyebrow">
              {row.industry}
              <span className="dot" />
              {detail ? TIMEFRAME_LABEL[detail.timeframe] : ''}
              {detail ? ` · ${chartConfirmation}-bar confirmation` : ''}
              {detail ? ` · ${SETUP_LABEL[chartMethod]}` : ''}
            </div>
            <h2>
              {row.symbol}
              <span className="drawer__name">{row.name}</span>
            </h2>
          </div>
          <div className="drawer__price">
            <strong>{formatPrice(row.close)}</strong>
            <span className={row.changePct === null ? 'flat' : row.changePct > 0 ? 'up' : row.changePct < 0 ? 'down' : 'flat'}>
              {formatPct(row.changePct)}
            </span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="drawer__body">
          {detail && (
            <div className="drawer__toolbar">
              <div className="drawer__toolbar-group">
                <div
                  className="segmented"
                  role="group"
                  aria-label="Chart swing method"
                >
                  <button
                    className={chartMethod === 'fractal' ? 'is-active' : ''}
                    onClick={() => setChartMethod('fractal')}
                    aria-pressed={chartMethod === 'fractal'}
                    title="Fractal swings (k=2)"
                  >
                    Fractal
                  </button>
                  <button
                    className={chartMethod === 'atr' ? 'is-active' : ''}
                    onClick={() => setChartMethod('atr')}
                    aria-pressed={chartMethod === 'atr'}
                    title="ATR zigzag swings (14, 2×)"
                  >
                    ATR
                  </button>
                </div>
                <div
                  className="segmented"
                  role="group"
                  aria-label="Chart confirmation"
                >
                  {([1, 2] as Confirmation[]).map((item) => (
                    <button
                      key={item}
                      className={chartConfirmation === item ? 'is-active' : ''}
                      onClick={() => setConfirmationOverride(item)}
                      aria-pressed={chartConfirmation === item}
                      title={
                        item === 1
                          ? 'Confirm on the first close beyond the swing'
                          : 'Require two consecutive closes beyond the swing'
                      }
                    >
                      {item} candle{item === 2 ? 's' : ''}
                    </button>
                  ))}
                </div>
              </div>
              {SHOW_TRADE_OVERLAY && detail.timeframe === 'day' && trades && (
                <div className="segmented" role="group" aria-label="Backtest overlay">
                  <button
                    className={tradeMode === 'off' ? 'is-active' : ''}
                    onClick={() => {
                      setTradeMode('off');
                      onClearFocus();
                    }}
                    aria-pressed={tradeMode === 'off'}
                  >
                    No trades
                  </button>
                  <button
                    className={tradeMode === 'fractal' ? 'is-active' : ''}
                    onClick={() => {
                      if (focus) switchMethod('fractal');
                      else setTradeMode('fractal');
                    }}
                    aria-pressed={tradeMode === 'fractal'}
                  >
                    Fractal trades
                  </button>
                  <button
                    className={tradeMode === 'atr' ? 'is-active' : ''}
                    onClick={() => {
                      if (focus) switchMethod('atr');
                      else setTradeMode('atr');
                    }}
                    aria-pressed={tradeMode === 'atr'}
                  >
                    ATR trades
                  </button>
                </div>
              )}
              <span className="drawer__legend">
                {focused ? (
                  <>
                    <i className="legend-dot legend-dot--entry" />
                    entry
                    <i className="legend-dot legend-dot--stop" />
                    stop
                    <i className="legend-dot legend-dot--target" />
                    2R target
                  </>
                ) : (
                  <>
                    <i className={`legend-dot legend-dot--${chartMethod}`} />
                    {SETUP_LABEL[chartMethod]}
                    <span>MSS flips · SL swing</span>
                  </>
                )}
              </span>
            </div>
          )}

          {focused && (
            <section className="trade-focus" aria-label="Trade inspection">
              <div className="trade-focus__bar">
                <div className="trade-focus__title">
                  <span className="trade-focus__eyebrow">Trade inspection</span>
                  <div className="trade-focus__setup">
                    <button
                      className={activeMethod === 'fractal' ? 'is-active' : ''}
                      onClick={() => switchMethod('fractal')}
                      title="Show the fractal setup for this episode"
                    >
                      Fractal
                    </button>
                    <button
                      className={activeMethod === 'atr' ? 'is-active' : ''}
                      onClick={() => switchMethod('atr')}
                      title="Show the ATR setup for this episode"
                    >
                      ATR
                    </button>
                    <span className={`pill pill--${focused.direction}`}>
                      {focused.direction === 'bullish' ? 'Long' : 'Short'}
                    </span>
                    <span className="trade-focus__count">
                      {focusPosition} / {focusTrades.length}
                    </span>
                  </div>
                </div>
                <div className="trade-focus__nav">
                  <button
                    onClick={() => stepFocus(-1)}
                    disabled={focusIndex <= 0}
                    aria-label="Previous trade"
                  >
                    ←
                  </button>
                  <button
                    onClick={() => stepFocus(1)}
                    disabled={focusIndex >= focusTrades.length - 1}
                    aria-label="Next trade"
                  >
                    →
                  </button>
                  <button
                    className="trade-focus__exit"
                    onClick={onClearFocus}
                  >
                    Exit
                  </button>
                </div>
              </div>

              <div className="trade-focus__grid">
                <div>
                  <span>Entry</span>
                  <strong className="num">{formatPrice(focused.entry)}</strong>
                  <small>{formatDate(focused.entryDate)}</small>
                </div>
                <div>
                  <span>MSS flip</span>
                  <strong className="num">{formatPrice(focused.signalLevel)}</strong>
                  <small>{formatDate(focused.signalDate)}</small>
                </div>
                <div>
                  <span>Stop</span>
                  <strong className="num down">{formatPrice(focused.stop)}</strong>
                  <small>{focused.riskPct.toFixed(2)}% risk</small>
                </div>
                <div>
                  <span>Target</span>
                  <strong className="num up">{formatPrice(focused.target)}</strong>
                  <small>2R</small>
                </div>
                <div>
                  <span>Exit</span>
                  <strong className="num">
                    {focused.exit === null ? '—' : formatPrice(focused.exit)}
                  </strong>
                  <small>
                    {focused.exitDate ? formatDate(focused.exitDate) : 'still open'}
                  </small>
                </div>
                <div>
                  <span>Result</span>
                  <strong
                    className={`num ${focused.r === null ? 'flat' : focused.r > 0 ? 'up' : focused.r < 0 ? 'down' : 'flat'}`}
                  >
                    {rValue(focused.r)}
                  </strong>
                  <small>{focused.exitReason}</small>
                </div>
                <div>
                  <span>MFE / MAE</span>
                  <strong className="num">
                    <span className="up">{rValue(focused.mfeR)}</span>
                    {' / '}
                    <span className="down">{rValue(focused.maeR)}</span>
                  </strong>
                  <small>{focused.barsHeld ?? '—'} bars held</small>
                </div>
              </div>

              <p className="trade-focus__note">{reasonText(focused, activeMethod)}</p>
            </section>
          )}

          <div className="drawer__chart">
            <button
              className="chart-expand"
              onClick={() => setChartFull(true)}
              aria-label="Full screen chart"
              title="Full screen"
            >
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 2H2v4M10 14h4v-4M14 6V2h-4M2 10v4h4" />
              </svg>
            </button>
            {loading && !detail && (
              <div className="chart-loading">
                <span className="spinner" /> Computing structure…
              </div>
            )}
            {!chartFull && <div ref={chartRef} className="chart-canvas" />}
          </div>

          {chartFull &&
            createPortal(
              <div className="chart-full" role="dialog" aria-modal="true" aria-label={`${row.symbol} chart, full screen`}>
                <div className="chart-full__bar">
                  <strong>{row.symbol}</strong>
                  <span className="chart-full__name">{row.name}</span>
                  <button
                    className="icon-btn"
                    onClick={() => {
                      if (startFull) {
                        onClose();
                        return;
                      }
                      setChartFull(false);
                    }}
                    aria-label="Exit full screen"
                  >
                    ✕
                  </button>
                </div>
                <div className="chart-full__body">
                  <div ref={chartRef} className="chart-canvas" />
                </div>
              </div>,
              document.body,
            )}

          {detail && (
            <>
              <div className="stat-grid">
                <div className="stat">
                  <span className="stat__label">Last shift</span>
                  <span className="stat__value">
                    {currentEvent ? (
                      <span className={`pill pill--${currentEvent.direction}`}>
                        {currentEvent.direction === 'bullish' ? 'Bullish' : 'Bearish'}
                      </span>
                    ) : (
                      'None'
                    )}
                  </span>
                  <span className="stat__sub">
                    {currentBarsSince === null
                      ? 'No confirmed shift in range'
                      : currentBarsSince === 0
                        ? 'Confirmed this bar'
                        : `${currentBarsSince} ${currentBarsSince === 1 ? 'bar' : 'bars'} ago · ${formatDate(currentEvent?.date)}`}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat__label">Broken level</span>
                  <span className="stat__value num">
                    {formatPrice(currentEvent?.level)}
                  </span>
                  <span className="stat__sub">
                    close {formatPrice(currentEvent?.close)} ·{' '}
                    {formatPct(currentEvent?.breakoutPct)} beyond
                  </span>
                </div>
                <div className="stat">
                  <span className="stat__label">Move since shift</span>
                  <span
                    className={`stat__value num ${
                      currentEvent
                        ? row.close >= currentEvent.close
                          ? 'up'
                          : 'down'
                        : ''
                    }`}
                  >
                    {formatPct(
                      currentEvent
                        ? (row.close / currentEvent.close - 1) * 100
                        : null,
                    )}
                  </span>
                  <span className="stat__sub">
                    {detail.bars.length} bars in detection range
                  </span>
                </div>
                <div className="stat">
                  <span className="stat__label">Active swing</span>
                  <span className="stat__value num">
                    {currentHigh !== null && currentLow !== null
                      ? `${formatPrice(currentLow)} – ${formatPrice(currentHigh)}`
                      : currentHigh !== null
                        ? `High ${formatPrice(currentHigh)}`
                        : currentLow !== null
                          ? `Low ${formatPrice(currentLow)}`
                          : '—'}
                  </span>
                  <span className="stat__sub">
                    {currentHigh === null || currentLow === null
                      ? 'One side already broken'
                      : 'Nearest confirmed low / high'}
                  </span>
                </div>
              </div>

              <section className="timeline">
                <h3>Recent shifts</h3>
                {recentEvents.length === 0 ? (
                  <p className="muted">No confirmed structure shift in this series.</p>
                ) : (
                  <ul>
                    {recentEvents.map((event) => (
                      <li key={`${event.date}-${event.direction}`}>
                        <span className="timeline__date">{formatDate(event.date)}</span>
                        <span className={`pill pill--${event.direction}`}>
                          {event.direction === 'bullish' ? 'Bullish' : 'Bearish'}
                        </span>
                        <span className="timeline__level num">
                          broke {formatPrice(event.level)}
                        </span>
                        <span className="timeline__close num">
                          close {formatPrice(event.close)}
                        </span>
                        <span className="timeline__pct num">
                          {formatPct(event.breakoutPct)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <p className="drawer__note">
                Detection uses the full 3-year series; the chart starts at a
                6-month view.{' '}
                {focused
                  ? `Inspecting one ${SETUP_LABEL[activeMethod]} trade on daily bars. The MSS arrows are this setup’s own flips (1-bar confirmation), so the entry should sit on the bar right after its arrow.`
                  : `Arrows are ${SETUP_LABEL[chartMethod]} MSS flips (${chartConfirmation}-bar confirmation). The SL marker is the swing ${chartStructure?.lastEvent?.direction === 'bearish' ? 'high' : 'low'} that backs the latest stop.`}
                {detail.provisional &&
                  ' Today’s bar is still forming and is excluded from confirmation.'}
              </p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
