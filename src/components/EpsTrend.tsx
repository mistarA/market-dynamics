import { formatDateShort } from '../lib/date';
import type { EpsInfo } from '../lib/types';
import { HoverPop, useHoverPop } from './HoverPop';

type Props = {
  /** `undefined` while loading, `null` when no quarter could be parsed. */
  info?: EpsInfo | null;
};

const W = 46;
const H = 14;
const PAD = 2;

/**
 * Quarterly EPS, last four quarters.
 *
 * The number is the latest reported quarter; the spark is its history and the
 * delta is quarter-on-quarter. The spark is auto-scaled to this stock's own
 * four-quarter min/max, so it conveys shape only — the hover says as much and
 * lists every quarter so the shape is verifiable rather than decorative.
 */
export function EpsTrend({ info }: Props) {
  const { ref, anchor, show, hide, cancelHide, dismiss } = useHoverPop<HTMLSpanElement>();

  if (info === undefined) {
    return <span className="eps eps--loading" aria-hidden="true" />;
  }

  const points = info?.points ?? [];
  if (points.length === 0) {
    return <span className="eps eps--empty">—</span>;
  }

  const values = points.map((point) => point.eps);
  const latest = values[values.length - 1];
  const prior = values.length > 1 ? values[values.length - 2] : null;
  const delta =
    prior !== null && prior !== 0 ? (latest / prior - 1) * 100 : null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? W / 2 : (index / (values.length - 1)) * W;
    const y = H - PAD - ((value - min) / span) * (H - PAD * 2);
    return [x, y] as const;
  });
  const polyline = coords
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const [lastX, lastY] = coords[coords.length - 1];

  const tone = delta === null ? '' : delta >= 0 ? ' eps--up' : ' eps--down';

  return (
    <span
      className={`eps${tone}`}
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
    >
      <span className="eps__value">{latest.toFixed(2)}</span>
      <svg
        className="eps__spark"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline points={polyline} fill="none" vectorEffect="non-scaling-stroke" />
        <circle cx={lastX} cy={lastY} r={1.6} />
      </svg>
      {delta !== null && (
        <span className="eps__delta">
          {delta >= 0 ? '+' : ''}
          {delta.toFixed(1)}%
        </span>
      )}

      <HoverPop
        anchor={anchor}
        onHold={cancelHide}
        onRelease={hide}
        onDismiss={dismiss}
      >
        <strong>EPS · last {points.length} quarters</strong>
        {points.map((point) => (
          <p key={point.period} className="eps__pop-row">
            <span>{formatDateShort(point.period)}</span>
            <b>{point.eps.toFixed(2)}</b>
          </p>
        ))}
        {delta !== null && (
          <p className="muted">
            {delta >= 0 ? 'Up' : 'Down'} {Math.abs(delta).toFixed(1)}% against the
            prior quarter.
          </p>
        )}
        <p className="muted">
          The spark is auto-scaled to this stock’s own four-quarter low–high:
          it shows shape, not magnitude. Read the % for size, and do not compare
          the steepness of one row’s line with another’s.
        </p>
        <span className="hover-pop__source">
          Basic EPS from continuing operations, parsed from each filing’s XBRL.
        </span>
      </HoverPop>
    </span>
  );
}
