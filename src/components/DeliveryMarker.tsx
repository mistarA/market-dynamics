import { formatDateShort } from '../lib/date';
import { formatCount } from '../lib/format';
import type { DeliveryInfo } from '../lib/types';
import { HoverPop, useHoverPop } from './HoverPop';

type Props = {
  /** `undefined` while loading, `null` when the server has no data. */
  info?: DeliveryInfo | null;
};

const H = 16;
const SLOT = 8;
const BAR = 6;

/**
 * Seven trading days of delivery vs intraday volume.
 *
 * Each column is one session: the filled portion is the quantity taken to
 * demat (DELIV_QTY / TTL_TRD_QNTY) and the remainder was squared off intraday.
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
  const width = days.length * SLOT;

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
        className="delivery__bars"
        viewBox={`0 0 ${width} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {days.map((day, index) => {
          const filled = (day.deliveryPct / 100) * H;
          return (
            <g key={day.date}>
              <rect
                className="delivery__intraday"
                x={index * SLOT}
                y={0}
                width={BAR}
                height={H}
                rx={1}
              />
              <rect
                className="delivery__delivered"
                x={index * SLOT}
                y={H - filled}
                width={BAR}
                height={filled}
                rx={1}
              />
            </g>
          );
        })}
      </svg>

      <HoverPop
        anchor={anchor}
        onHold={cancelHide}
        onRelease={hide}
        onDismiss={dismiss}
      >
        <strong>Delivery vs intraday · {days.length} sessions</strong>
        <p>
          Each bar is one trading day. Filled = shares delivered to demat;
          the remainder was squared off intraday. Latest {latest.toFixed(2)}%,
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
