import { formatDateShort } from '../lib/date';
import { formatCount } from '../lib/format';
import type { DeliveryInfo } from '../lib/types';
import { HoverPop, useHoverPop } from './HoverPop';

type Props = {
  /** `undefined` while loading, `null` when the server has no data. */
  info?: DeliveryInfo | null;
};

const W = 56;
const H = 16;

/**
 * Seven trading days of delivery share, drawn as a line rather than bars.
 *
 * Each point is DELIV_QTY / TTL_TRD_QNTY for that session; the dashed midline
 * is 50%, so a point above it means more volume was delivered than squared off.
 */
export function DeliveryMarker({ info }: Props) {
  const { ref, anchor, show, hide, cancelHide, dismiss } =
    useHoverPop<HTMLSpanElement>();

  if (info === undefined) {
    return <span className="delivery delivery--loading" aria-hidden="true" />;
  }

  const days = info?.days ?? [];
  if (days.length === 0) {
    return <span className="delivery delivery--empty">—</span>;
  }

  const latest = days[days.length - 1].deliveryPct;
  const average =
    days.reduce((total, day) => total + day.deliveryPct, 0) / days.length;
  const points = days.map((day, index) => {
    const x = days.length === 1 ? W / 2 : (index / (days.length - 1)) * W;
    const y = H - (day.deliveryPct / 100) * H;
    return [x, y] as const;
  });
  const polyline = points
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const [lastX, lastY] = points[points.length - 1];

  return (
    <span
      className="delivery"
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
    >
      <span className="delivery__value">{Math.round(latest)}%</span>
      <svg
        className="delivery__spark"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect
          className="delivery__above"
          x={0}
          y={0}
          width={W}
          height={H / 2}
        />
        <polyline
          className="delivery__line"
          points={polyline}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        {/* Drawn last so the 50% reference is never hidden by the data line. */}
        <line
          className="delivery__midline"
          x1={0}
          y1={H / 2}
          x2={W}
          y2={H / 2}
          vectorEffect="non-scaling-stroke"
        />
        <circle className="delivery__dot" cx={lastX} cy={lastY} r={1.8} />
      </svg>

      <HoverPop
        anchor={anchor}
        onHold={cancelHide}
        onRelease={hide}
        onDismiss={dismiss}
      >
        <strong>Delivery vs intraday · {days.length} sessions</strong>
        <p>
          The line is each session’s delivered share of traded quantity. The
          shaded half and dashed line mark 50% — above it more shares went to
          demat than were squared off intraday. Latest {latest.toFixed(2)}%,
          seven-day average {average.toFixed(2)}%.
        </p>
        {days.map((day) => (
          <p className="delivery__pop-row" key={day.date}>
            <span>{formatDateShort(day.date)}</span>
            <b>
              {day.deliveryPct.toFixed(2)}% / {day.intradayPct.toFixed(2)}%
            </b>
          </p>
        ))}
        <span className="hover-pop__source">
          NSE daily bhavcopy · DELIV_QTY / TTL_TRD_QNTY ·{' '}
          {formatCount(days[days.length - 1].trades)} trades on the latest day.
        </span>
      </HoverPop>
    </span>
  );
}
