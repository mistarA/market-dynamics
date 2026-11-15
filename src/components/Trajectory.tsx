import type {
  DeliveryInfo,
  EpsInfo,
  ResultInfo,
  Row,
} from '../lib/types';
import { DeliveryMarker } from './DeliveryMarker';
import { EpsTrend } from './EpsTrend';
import { RangeBar } from './RangeBar';
import { ResultTrack } from './ResultTrack';
import { VolumeTrend } from './VolumeTrend';

type Props = {
  row: Row;
  /** Result dates, loaded after the snapshot. */
  info?: ResultInfo | null;
  /** Quarterly EPS, loaded after the dates. */
  eps?: EpsInfo | null;
  /** Seven-day delivery split, loaded separately. */
  delivery?: DeliveryInfo | null;
  /** On mobile the whole block opens the details dialog. */
  onActivate?: () => void;
  /** Mobile pairs EPS/DEL and QTR/VOL into two columns to save height. */
  compact?: boolean;
  /** Web shows DEL/VOL in their own columns, so its indicator cell has three rows. */
  includeParticipation?: boolean;
};

/**
 * The five research signals for one stock in a single cell.
 *
 *   52W  where today sits inside the year's high–low
 *   EPS  the latest quarter and its four-quarter trend
 *   Qtr  the last filed result and the next board meeting
 *   DEL  seven sessions of delivered vs intraday volume
 *   Vol  traded quantity for the selected timeframe
 *
 * Desktop stacks all five; mobile keeps 52W full width and pairs the rest.
 */
export function Trajectory({
  row,
  info,
  eps,
  delivery,
  onActivate,
  compact = false,
  includeParticipation = true,
}: Props) {
  const tappable = Boolean(onActivate);

  const rangeLine = (
    <div className="traj__row">
      <span className="traj__label">52W</span>
      <RangeBar low={row.low52} high={row.high52} value={row.close} />
    </div>
  );
  const epsLine = (
    <div className="traj__row">
      <span className="traj__label">EPS</span>
      <EpsTrend info={eps} />
    </div>
  );
  const qtrLine = (
    <div className="traj__row">
      <span className="traj__label">Qtr</span>
      <ResultTrack symbol={row.symbol} info={info} />
    </div>
  );
  const delLine = includeParticipation ? (
    <div className="traj__row">
      <span className="traj__label">DEL</span>
      <DeliveryMarker info={delivery} />
    </div>
  ) : null;
  const volLine = includeParticipation ? (
    <div className="traj__row">
      <span className="traj__label">Vol</span>
      <VolumeTrend values={row.volumeSpark} timeframe={row.timeframe} />
    </div>
  ) : null;

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
      {rangeLine}
      {compact ? (
        <>
          <div className="traj__pair">
            {epsLine}
            {delLine}
          </div>
          <div className="traj__pair">
            {qtrLine}
            {volLine}
          </div>
        </>
      ) : (
        <>
          {epsLine}
          {qtrLine}
          {delLine}
          {volLine}
        </>
      )}
    </div>
  );
}
