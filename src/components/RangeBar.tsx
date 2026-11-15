import { formatPrice } from '../lib/format';
import { HoverPop, useHoverPop } from './HoverPop';

type Props = {
  low: number | null;
  high: number | null;
  value: number;
  /** Show the exact low/high numbers under the track. */
  scale?: boolean;
  className?: string;
};

/**
 * Where the close sits inside the trailing 52-week range.
 *
 * The track is the year's low-to-high span, the fill is the distance travelled
 * from the low, and the dot is today. Hovering spells out the exact numbers.
 */
export function RangeBar({
  low,
  high,
  value,
  scale = true,
  className,
}: Props) {
  const { ref, anchor, show, hide, cancelHide, dismiss } = useHoverPop<HTMLDivElement>();

  if (
    low === null ||
    high === null ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    high <= low
  ) {
    return <span className="range range--empty">—</span>;
  }

  const pos = Math.min(1, Math.max(0, (value - low) / (high - low)));
  const offHigh = high > 0 ? (value / high - 1) * 100 : null;

  return (
    <div
      className={['range', className].filter(Boolean).join(' ')}
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
    >
      <div
        className="range__track"
        role="img"
        aria-label={`${formatPrice(value)} inside a 52-week range of ${formatPrice(low)} to ${formatPrice(high)}`}
      >
        <span className="range__fill" style={{ width: `${pos * 100}%` }} />
        <span className="range__dot" style={{ left: `${pos * 100}%` }} />
      </div>
      {scale && (
        <div className="range__scale">
          <span>{formatPrice(low)}</span>
          <span>{formatPrice(high)}</span>
        </div>
      )}

      <HoverPop
        anchor={anchor}
        onHold={cancelHide}
        onRelease={hide}
        onDismiss={dismiss}
      >
        <strong>52-week range</strong>
        <p>
          Low {formatPrice(low)} · High {formatPrice(high)}
        </p>
        <p>
          Now {formatPrice(value)}
          {offHigh !== null
            ? ` · ${Math.abs(offHigh).toFixed(2)}% ${offHigh <= 0 ? 'below' : 'above'} the high`
            : ''}
        </p>
        <span className="hover-pop__source">
          Highest high and lowest low of the last 365 days of bars.
        </span>
      </HoverPop>
    </div>
  );
}
