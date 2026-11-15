import { TIMEFRAME_LABEL } from '../lib/date';
import { formatCount } from '../lib/format';
import type { Timeframe } from '../lib/types';
import { HoverPop, useHoverPop } from './HoverPop';

type Props = {
  /** Volumes for the selected timeframe's bars, oldest first. */
  values: number[];
  timeframe: Timeframe;
};

const W = 60;
const H = 16;
const UNIT: Record<Timeframe, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

/**
 * Volume histogram: one bar per session, taller means more shares traded.
 *
 * `values` comes from the already-aggregated bars, so switching to weekly or
 * monthly automatically shows summed volume for those periods.
 */
export function VolumeTrend({ values, timeframe }: Props) {
  const { ref, anchor, show, hide, cancelHide, dismiss } =
    useHoverPop<HTMLSpanElement>();

  if (values.length < 2) {
    return <span className="volume volume--empty">—</span>;
  }

  const max = Math.max(...values) || 1;
  const latest = values[values.length - 1];
  const prior = values[values.length - 2];
  const step = W / values.length;
  const barWidth = Math.max(0.8, step - 0.6);

  return (
    <span
      className="volume"
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
    >
      <svg
        className="volume__spark"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {values.map((value, index) => {
          const height = Math.max(1, (value / max) * H);
          return (
            <rect
              key={index}
              className={
                index === values.length - 1
                  ? 'volume__bar volume__bar--last'
                  : 'volume__bar'
              }
              x={index * step}
              y={H - height}
              width={barWidth}
              height={height}
            />
          );
        })}
      </svg>

      <HoverPop
        anchor={anchor}
        onHold={cancelHide}
        onRelease={hide}
        onDismiss={dismiss}
      >
        <strong>Volume · {TIMEFRAME_LABEL[timeframe]}</strong>
        <p>
          Each bar is one {UNIT[timeframe]}’s traded shares — taller means more
          volume. Bars are scaled to the busiest {UNIT[timeframe]} shown, so
          this shows the shape of activity, not absolute share counts.
        </p>
        <p className="muted">
          Latest {formatCount(latest)} · previous {formatCount(prior)}. Weekly
          and monthly bars add up every session in that period.
        </p>
        <span className="hover-pop__source">
          {values.length} {TIMEFRAME_LABEL[timeframe].toLowerCase()} bars · NSE
          charting snapshot.
        </span>
      </HoverPop>
    </span>
  );
}
