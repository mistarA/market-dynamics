import type { EpsInfo, ResultInfo, Row } from '../lib/types';
import { EpsTrend } from './EpsTrend';
import { RangeBar } from './RangeBar';
import { ResultTrack } from './ResultTrack';

type Props = {
  row: Row;
  /** Result dates, loaded after the snapshot. */
  info?: ResultInfo | null;
  /** Quarterly EPS, loaded after the dates. */
  eps?: EpsInfo | null;
  /** On mobile the whole block opens the details dialog. */
  onActivate?: () => void;
};

/**
 * The three research signals for one stock, stacked in a single cell.
 *
 *   52W  where today sits inside the year's high–low
 *   EPS  the latest quarter and its four-quarter trend
 *   Qtr  the last filed result and the next board meeting
 *
 * Each line explains itself on hover; the label column keeps the meaning
 * visible without one. When `onActivate` is supplied (mobile) the entire
 * block is one tap target, so there is no separate "Details" button.
 */
export function Trajectory({ row, info, eps, onActivate }: Props) {
  const tappable = Boolean(onActivate);

  return (
    <div
      className={tappable ? 'traj traj--tappable' : 'traj'}
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      aria-label={tappable ? `Open details for ${row.symbol}` : undefined}
      onClick={
        tappable
          ? (event) => {
              event.stopPropagation();
              onActivate?.();
            }
          : undefined
      }
      onKeyDown={
        tappable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onActivate?.();
              }
            }
          : undefined
      }
    >
      <div className="traj__row">
        <span className="traj__label">52W</span>
        <RangeBar low={row.low52} high={row.high52} value={row.close} />
      </div>
      <div className="traj__row">
        <span className="traj__label">EPS</span>
        <EpsTrend info={eps} />
      </div>
      <div className="traj__row">
        <span className="traj__label">Qtr</span>
        <ResultTrack symbol={row.symbol} info={info} />
      </div>
    </div>
  );
}
