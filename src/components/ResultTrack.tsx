import { useState } from 'react';
import { fetchResultDetail } from '../lib/api';
import { formatDate, formatDateShort } from '../lib/date';
import type { ResultDetail, ResultInfo } from '../lib/types';
import { FilingsList } from './FilingsList';
import { HoverPop, useHoverPop } from './HoverPop';

type Props = {
  symbol: string;
  /** `undefined` while loading, `null` when the server has no dates. */
  info?: ResultInfo | null;
};

/**
 * The last filing with the quarter it covers: `05 Nov [30 Sept]`.
 *
 * A filled dot marks the filed quarter. When NSE has published the next board
 * meeting, its date is appended after a centre dot. Nothing is invented and
 * nothing is repeated when no date exists yet — the hover explains the gap.
 */
export function ResultTrack({ symbol, info }: Props) {
  const [detail, setDetail] = useState<ResultDetail | undefined>(undefined);
  const { ref, anchor, show, hide, cancelHide, dismiss } = useHoverPop<HTMLSpanElement>();

  const open = () => {
    show();
    if (detail === undefined) {
      void fetchResultDetail(symbol).then(setDetail);
    }
  };

  if (info === undefined) {
    return <span className="result result--loading" aria-hidden="true" />;
  }

  if (!info || (!info.lastFiled && !info.nextDate)) {
    return <span className="result result--empty">No filings</span>;
  }

  return (
    <span
      className="result"
      ref={ref}
      onMouseEnter={open}
      onMouseLeave={hide}
      onFocus={open}
      onBlur={hide}
      tabIndex={0}
    >
      <span className="result__line">
        <span className="result__dot" aria-hidden="true" />
        <span className="result__date">
          {info.lastFiled ? formatDateShort(info.lastFiled) : '—'}
        </span>
        {info.lastPeriod && (
          <span className="result__period">
            [{formatDateShort(info.lastPeriod)}]
          </span>
        )}
        {info.nextDate && (
          <>
            <span className="result__sep" aria-hidden="true">
              ·
            </span>
            <span className="result__date result__date--next">
              {formatDateShort(info.nextDate)}
            </span>
          </>
        )}
      </span>

      <HoverPop
        anchor={anchor}
        onHold={cancelHide}
        onRelease={hide}
        onDismiss={dismiss}
      >
        <strong>{symbol} · quarterly results</strong>
        {info.lastFiled && (
          <p>
            Last filed {formatDate(info.lastFiled)}
            {info.lastPeriod
              ? ` for the quarter ended ${formatDate(info.lastPeriod)}`
              : ''}
            .
          </p>
        )}
        {info.nextDate ? (
          <p>
            Next board meeting {formatDate(info.nextDate)}
            {info.nextPurpose ? ` — ${info.nextPurpose}` : ''}. Confirmed by NSE.
          </p>
        ) : (
          <p className="muted">
            No next date in the row because NSE only lists board meetings a few
            weeks ahead; one appears after the company intimates the exchange.
          </p>
        )}
        {detail === undefined && (
          <p className="muted">Loading the exchange summary…</p>
        )}
        {detail?.summary === null && (
          <p className="muted">No summary available for this result.</p>
        )}
        {detail?.summary && (
          <>
            <p className="result__summary">{detail.summary.summary}</p>
            <span className="hover-pop__source">
              NSE announcement · {formatDate(detail.summary.date)}
            </span>
          </>
        )}
        <div className="hover-pop__filings">
          <strong>Exchange filings</strong>
          <FilingsList
            filings={detail?.filings ?? []}
            limit={3}
            loading={detail === undefined}
          />
        </div>
      </HoverPop>
    </span>
  );
}
