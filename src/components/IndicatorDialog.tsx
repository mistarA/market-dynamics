import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchResultDetail } from '../lib/api';
import { useBackClose } from '../lib/backPress';
import { formatDate, formatDateShort, TIMEFRAME_LABEL } from '../lib/date';
import { formatCount, formatPrice } from '../lib/format';
import type {
  DeliveryInfo,
  EpsInfo,
  ResultDetail,
  ResultInfo,
  Row,
} from '../lib/types';
import { FilingsList } from './FilingsList';
import { RangeBar } from './RangeBar';

type Props = {
  symbol: string;
  row: Row;
  info?: ResultInfo | null;
  eps?: EpsInfo | null;
  delivery?: DeliveryInfo | null;
  onClose: () => void;
};

/**
 * Mobile detail view for the merged indicator. The card already shows the
 * three compact lines; this dialog spells out the numbers behind them and adds
 * the exchange filings that do not fit in a row.
 */
export function IndicatorDialog({
  symbol,
  row,
  info,
  eps,
  delivery,
  onClose,
}: Props) {
  const [detail, setDetail] = useState<ResultDetail | undefined>(undefined);
  useBackClose(true, onClose);

  useEffect(() => {
    let cancelled = false;
    void fetchResultDetail(symbol).then((value) => {
      if (!cancelled) setDetail(value);
    });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const points = eps?.points ?? [];
  const days = delivery?.days ?? [];
  const volumes = row.volumeSpark;
  const latest = points.length ? points[points.length - 1].eps : null;
  const prior = points.length > 1 ? points[points.length - 2].eps : null;
  const delta =
    latest !== null && prior !== null && prior !== 0
      ? (latest / prior - 1) * 100
      : null;

  return createPortal(
    <div className="ind-overlay" onClick={onClose}>
      <div
        className="ind-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${symbol} indicator details`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ind-dialog__head">
          <div>
            <strong>{symbol}</strong>
            <span>{row.name}</span>
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            aria-label="Close details"
          >
            ✕
          </button>
        </header>

        <div className="ind-dialog__body">
          <section className="ind-section">
            <h2>52-week range</h2>
            <RangeBar
              low={row.low52}
              high={row.high52}
              value={row.close}
              scale
            />
            <dl className="ind-stats">
              <div>
                <dt>Low</dt>
                <dd>{formatPrice(row.low52)}</dd>
              </div>
              <div>
                <dt>High</dt>
                <dd>{formatPrice(row.high52)}</dd>
              </div>
              <div>
                <dt>Now</dt>
                <dd>{formatPrice(row.close)}</dd>
              </div>
              <div>
                <dt>Off high</dt>
                <dd>
                  {row.offHighPct === null
                    ? '—'
                    : `${row.offHighPct.toFixed(2)}%`}
                </dd>
              </div>
            </dl>
            <p className="ind-note">
              The dot is today’s close inside the highest high and lowest low
              of the last 365 days of bars.
            </p>
          </section>

          <section className="ind-section">
            <h2>EPS · last {points.length || 0} quarters</h2>
            {points.length === 0 ? (
              <p className="muted">No EPS history parsed for this symbol.</p>
            ) : (
              <>
                <ul className="ind-eps">
                  {points.map((point) => (
                    <li key={point.period}>
                      <span>{formatDateShort(point.period)}</span>
                      <b>{point.eps.toFixed(2)}</b>
                    </li>
                  ))}
                </ul>
                {delta !== null && (
                  <p className="ind-note">
                    Latest quarter {delta >= 0 ? 'up' : 'down'}{' '}
                    {Math.abs(delta).toFixed(1)}% against the prior quarter.
                    The spark is auto-scaled to this stock’s own four-quarter
                    low–high, so it shows shape, not magnitude.
                  </p>
                )}
              </>
            )}
          </section>

          <section className="ind-section">
            <h2>Quarterly results</h2>
            <dl className="ind-stats ind-stats--wide">
              <div>
                <dt>Last filed</dt>
                <dd>{info?.lastFiled ? formatDate(info.lastFiled) : '—'}</dd>
              </div>
              <div>
                <dt>Quarter ended</dt>
                <dd>{info?.lastPeriod ? formatDate(info.lastPeriod) : '—'}</dd>
              </div>
              <div>
                <dt>Next meeting</dt>
                <dd>
                  {info?.nextDate ? formatDate(info.nextDate) : 'Not announced'}
                </dd>
              </div>
            </dl>
            <p className="ind-note">
              The row shows the last filing date with that quarter’s end in
              brackets. NSE lists board meetings only a few weeks ahead, so the
              next date appears once the company intimates the exchange.
            </p>
          </section>

          <section className="ind-section">
            <h2>Delivery vs intraday · {days.length || 7} sessions</h2>
            {days.length === 0 ? (
              <p className="muted">No delivery data for this symbol.</p>
            ) : (
              <>
                <ul className="ind-eps">
                  {days.map((day) => (
                    <li key={day.date}>
                      <span>{formatDateShort(day.date)}</span>
                      <b>
                        {day.deliveryPct.toFixed(2)}% delivered /{' '}
                        {day.intradayPct.toFixed(2)}% intraday
                      </b>
                    </li>
                  ))}
                </ul>
                <p className="ind-note">
                  Each day's delivered quantity as a share of traded quantity;
                  the rest was squared off within the session. From the NSE
                  daily bhavcopy.
                </p>
              </>
            )}
          </section>

          <section className="ind-section">
            <h2>Volume · {TIMEFRAME_LABEL[row.timeframe]}</h2>
            {volumes.length < 2 ? (
              <p className="muted">No volume history for this symbol.</p>
            ) : (
              <>
                <ul className="ind-eps">
                  {volumes.slice(-5).map((value, index) => (
                    <li key={index}>
                      <span>{index === 0 ? 'earlier' : `bar −${volumes.slice(-5).length - 1 - index}`}</span>
                      <b>{formatCount(value)}</b>
                    </li>
                  ))}
                </ul>
                <p className="ind-note">
                  The histogram uses the same {volumes.length}{' '}
                  {TIMEFRAME_LABEL[row.timeframe].toLowerCase()} bars as the
                  price sparkline. Weekly and monthly bars sum their sessions.
                </p>
              </>
            )}
          </section>

          <section className="ind-section">
            <h2>Exchange filings</h2>
            <p className="ind-note">
              Date, what was filed, and the original NSE documents.
            </p>
            <FilingsList
              filings={detail?.filings ?? []}
              loading={detail === undefined}
            />
            {detail?.summary && (
              <p className="result__summary ind-summary">
                {detail.summary.summary}
              </p>
            )}
          </section>
        </div>

        <footer className="ind-dialog__foot">
          <a href={`#/research/${encodeURIComponent(symbol)}`}>
            Full research page ↗
          </a>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
