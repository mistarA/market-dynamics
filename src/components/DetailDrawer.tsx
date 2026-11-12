import { useEffect, useMemo, useRef, useState } from 'react';
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
import { findExternalMarkers, findZigzagPivots } from '../lib/swings';
import type {
  BacktestTrade,
  Detail,
  Direction,
  Row,
  SwingMethod,
} from '../lib/types';

type PivotMode = 'external' | 'all';
type TradeMode = 'off' | SwingMethod;

export type FocusTrade = {
  method: SwingMethod;
  symbol: string;
  entryDate: string;
  direction: Direction;
};

const SWING_HIGH = 'rgba(245,158,11,0.85)';
const SWING_LOW = 'rgba(56,189,248,0.85)';
const METHOD_COLOR: Record<SwingMethod, string> = {
  fractal: '#818cf8',
  atr: '#f5b544',
};
const SETUP_LABEL: Record<SwingMethod, string> = {
  fractal: 'Fractal k=2',
  atr: 'ATR 14 · 2×',
};

const EXIT_COLOR: Record<BacktestTrade['exitReason'], string> = {
  target: '#22c55e',
  stop: '#ef4444',
  flip: '#818cf8',
  ambiguous: '#f5b544',
  open: '#8b97a8',
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
  onClearFocus: () => void;
  onClose: () => void;
};

export function DetailDrawer({
  row,
  detail,
  loading,
  theme,
  focus,
  onClearFocus,
  onClose,
}: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [pivotMode, setPivotMode] = useState<PivotMode>('external');
  const [tradeMode, setTradeMode] = useState<TradeMode>('off');
  const [focusMethod, setFocusMethod] = useState<SwingMethod | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  /**
   * External swings are found on the same confirmed bars as MSS: when today is
   * still forming, the final bar is excluded from confirmation.
   */
  const detectionBars = useMemo(() => {
    if (!detail) return [];
    return detail.provisional ? detail.bars.slice(0, -1) : detail.bars;
  }, [detail]);

  const externalSwings = useMemo(
    () => findExternalMarkers(findZigzagPivots(detectionBars)),
    [detectionBars],
  );

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

  const activeMethod: SwingMethod = focusMethod ?? focus?.method ?? 'fractal';
  const focusTrades = trades ? trades[activeMethod] : [];

  useEffect(() => {
    if (!focus || !trades) return;
    setFocusMethod(focus.method);
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
      setFocusMethod(null);
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
    setFocusMethod(next);
    setTradeMode(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const container = chartRef.current;
    if (!detail || !container || detail.bars.length === 0) return;

    const light = theme === 'light';
    const textColor = light ? '#475569' : '#8b97a8';
    const gridLine = light ? 'rgba(15,23,42,0.07)' : 'rgba(255,255,255,0.035)';
    const axisLine = light ? 'rgba(15,23,42,0.14)' : 'rgba(255,255,255,0.08)';
    const labelBg = light ? '#e2e8f0' : '#1f2937';

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor,
        fontFamily:
          "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
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
        vertLine: { color: 'rgba(129,140,248,0.4)', labelBackgroundColor: labelBg },
        horzLine: { color: 'rgba(129,140,248,0.4)', labelBackgroundColor: labelBg },
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: 'rgba(34,197,94,0.8)',
      wickDownColor: 'rgba(239,68,68,0.8)',
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

    const cutoff =
      detail.timeframe === 'day'
        ? detail.bars.length - 180
        : detail.timeframe === 'week'
          ? detail.bars.length - 80
          : detail.bars.length - 36;

    const markers: SeriesMarker<Time>[] = [];
    if (pivotMode === 'external') {
      for (const swing of externalSwings) {
        if (swing.idx < cutoff) continue;
        markers.push({
          time: swing.date as Time,
          position: swing.kind === 'high' ? 'aboveBar' : 'belowBar',
          color: swing.kind === 'high' ? SWING_HIGH : SWING_LOW,
          shape: 'circle',
          text: swing.label ?? undefined,
          size: 1,
        });
      }
    } else {
      for (const pivot of detail.pivots) {
        if (pivot.idx < cutoff) continue;
        markers.push({
          time: pivot.date as Time,
          position: pivot.kind === 'high' ? 'aboveBar' : 'belowBar',
          color: pivot.kind === 'high' ? 'rgba(245,158,11,0.55)' : 'rgba(56,189,248,0.55)',
          shape: 'circle',
          size: 0.6,
        });
      }
    }
    for (const event of detail.events) {
      markers.push({
        time: event.date as Time,
        position: event.direction === 'bullish' ? 'belowBar' : 'aboveBar',
        color: event.direction === 'bullish' ? '#22c55e' : '#ef4444',
        shape: event.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
        text: 'MSS',
        size: 1.2,
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
    } else if (tradeMode !== 'off' && trades) {
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
        color: 'rgba(239,68,68,0.9)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'stop',
      });
      series.createPriceLine({
        price: focused.target,
        color: 'rgba(34,197,94,0.9)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '2R target',
      });
    } else {
      if (detail.activeHigh !== null) {
        series.createPriceLine({
          price: detail.activeHigh,
          color: 'rgba(239,68,68,0.45)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'swing high',
        });
      }
      if (detail.activeLow !== null) {
        series.createPriceLine({
          price: detail.activeLow,
          color: 'rgba(34,197,94,0.45)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'swing low',
        });
      }
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
    pivotMode,
    externalSwings,
    trades,
    tradeMode,
    focus,
    focused,
    activeMethod,
  ]);

  if (!row) return null;

  const recentEvents = detail ? [...detail.events].slice(-8).reverse() : [];
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
              {detail ? ` · ${detail.confirmation}-bar confirmation` : ''}
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
              <div className="segmented" role="group" aria-label="Marker mode">
                <button
                  className={pivotMode === 'external' ? 'is-active' : ''}
                  onClick={() => setPivotMode('external')}
                  aria-pressed={pivotMode === 'external'}
                >
                  External swings
                </button>
                <button
                  className={pivotMode === 'all' ? 'is-active' : ''}
                  onClick={() => setPivotMode('all')}
                  aria-pressed={pivotMode === 'all'}
                >
                  All pivots
                </button>
              </div>
              {detail.timeframe === 'day' && trades && (
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
                ) : tradeMode !== 'off' ? (
                  <>
                    <i className={`legend-dot legend-dot--${tradeMode}`} />
                    {tradeMode === 'fractal' ? 'fractal entry' : 'ATR entry'}
                    <i className="legend-dot legend-dot--win" />
                    win
                    <i className="legend-dot legend-dot--loss" />
                    loss / other
                  </>
                ) : pivotMode === 'external' ? (
                  <>
                    <i className="legend-dot legend-dot--high" />
                    HH / LH
                    <i className="legend-dot legend-dot--low" />
                    HL / LL
                  </>
                ) : (
                  <>
                    <i className="legend-dot legend-dot--high" />
                    swing high
                    <i className="legend-dot legend-dot--low" />
                    swing low
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

              <p className="trade-focus__note">{reasonText(focused)}</p>
            </section>
          )}

          <div className="drawer__chart">
            {loading && !detail && (
              <div className="chart-loading">
                <span className="spinner" /> Computing structure…
              </div>
            )}
            <div ref={chartRef} className="chart-canvas" />
          </div>

          {detail && (
            <>
              <div className="stat-grid">
                <div className="stat">
                  <span className="stat__label">Last shift</span>
                  <span className="stat__value">
                    {detail.lastEvent ? (
                      <span className={`pill pill--${detail.lastEvent.direction}`}>
                        {detail.lastEvent.direction === 'bullish' ? 'Bullish' : 'Bearish'}
                      </span>
                    ) : (
                      'None'
                    )}
                  </span>
                  <span className="stat__sub">
                    {detail.barsSince === null
                      ? 'No confirmed shift in range'
                      : detail.barsSince === 0
                        ? 'Confirmed this bar'
                        : `${detail.barsSince} ${detail.barsSince === 1 ? 'bar' : 'bars'} ago · ${formatDate(detail.lastEvent?.date)}`}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat__label">Broken level</span>
                  <span className="stat__value num">
                    {formatPrice(detail.lastEvent?.level)}
                  </span>
                  <span className="stat__sub">
                    close {formatPrice(detail.lastEvent?.close)} ·{' '}
                    {formatPct(detail.lastEvent?.breakoutPct)} beyond
                  </span>
                </div>
                <div className="stat">
                  <span className="stat__label">Move since shift</span>
                  <span
                    className={`stat__value num ${
                      detail.lastEvent
                        ? row.close >= detail.lastEvent.close
                          ? 'up'
                          : 'down'
                        : ''
                    }`}
                  >
                    {formatPct(
                      detail.lastEvent
                        ? (row.close / detail.lastEvent.close - 1) * 100
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
                    {detail.activeHigh !== null && detail.activeLow !== null
                      ? `${formatPrice(detail.activeLow)} – ${formatPrice(detail.activeHigh)}`
                      : detail.activeHigh !== null
                        ? `High ${formatPrice(detail.activeHigh)}`
                        : detail.activeLow !== null
                          ? `Low ${formatPrice(detail.activeLow)}`
                          : '—'}
                  </span>
                  <span className="stat__sub">
                    {detail.activeHigh === null || detail.activeLow === null
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
                  ? `Inspecting one ${SETUP_LABEL[activeMethod]} trade on daily bars. Use ← → to step through that setup, or switch to the other setup to compare the same episode.`
                  : pivotMode === 'external'
                    ? 'External swings use an ATR zigzag (2 × ATR 14), labelled against the previous swing of the same kind. Highs and lows alternate.'
                    : 'Circles mark every confirmed fractal pivot (k=2).'}
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
