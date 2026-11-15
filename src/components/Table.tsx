import { useEffect, useState } from 'react';
import { cleanIndustry, formatPrice } from '../lib/format';
import { formatDateShort } from '../lib/date';
import type { SortKey } from '../lib/rank';
import type { EpsInfo, Row, ResultInfo } from '../lib/types';
import { IndicatorDialog } from './IndicatorDialog';
import { Sparkline } from './Sparkline';
import { Trajectory } from './Trajectory';

/** Cards replace the table below this width; keep the breakpoint in sync with CSS. */
const NARROW = '(max-width: 620px)';

type Props = {
  rows: Row[];
  selected: string | null;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  onSort: (key: SortKey) => void;
  onSelect: (symbol: string) => void;
  /** Opens the symbol straight into the full-screen chart. */
  onChart: (symbol: string) => void;
  /** Result dates per symbol, loaded separately from the snapshot. */
  results: Record<string, ResultInfo | null>;
  /** Quarterly EPS per symbol, loaded separately again. */
  eps: Record<string, EpsInfo>;
};

function sortIndicator(
  sort: Props['sort'],
  key: SortKey,
): string {
  if (sort.key !== key) return '';
  return sort.dir === 'asc' ? ' ↑' : ' ↓';
}

function ageClass(barsSince: number | null): string {
  if (barsSince === null) return 'age age--none';
  if (barsSince <= 2) return 'age age--hot';
  if (barsSince <= 5) return 'age age--warm';
  return 'age';
}

function ageText(barsSince: number | null): string {
  if (barsSince === null) return 'No shift';
  if (barsSince === 0) return 'This bar';
  return barsSince === 1 ? '1 bar ago' : `${barsSince} bars ago`;
}

function pctText(value: number | null): string {
  if (value === null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function sinceClass(row: Row): string {
  if (row.sincePct === null || row.sincePct === 0) return 'flat';
  const aligned =
    row.direction === 'bullish'
      ? row.sincePct > 0
      : row.sincePct < 0;
  if (aligned) return 'right';
  return row.sincePct > 0 ? 'up' : 'down';
}

/** Opens the symbol's dedicated research page. Plain hash link, so it shares. */
function ResearchLink({
  symbol,
  className,
  book = false,
}: {
  symbol: string;
  className: string;
  /** Mobile cards use a book (read the research); desktop keeps the external arrow. */
  book?: boolean;
}) {
  return (
    <a
      className={className}
      href={`#/research/${encodeURIComponent(symbol)}`}
      title={`Research links for ${symbol}`}
      aria-label={`Research links for ${symbol}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {book ? (
        <svg
          viewBox="0 0 16 16"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 4.4C6.5 3.2 4.6 2.8 2.4 3v9.1c2.2-.2 4.1.2 5.6 1.4 1.5-1.2 3.4-1.6 5.6-1.4V3c-2.2-.2-4.1.2-5.6 1.4z" />
          <path d="M8 4.4v9.1" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6.4 9.6 13.6 2.4" />
          <path d="M8.6 2.4h5v5" />
          <path d="M12.2 9.4v3.2a1.4 1.4 0 0 1-1.4 1.4H3.8a1.4 1.4 0 0 1-1.4-1.4V5.6a1.4 1.4 0 0 1 1.4-1.4h3.2" />
        </svg>
      )}
    </a>
  );
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener('change', onChange);
    // Emulation and a few mobile browsers only report the resize.
    window.addEventListener('resize', onChange);
    onChange();
    return () => {
      query.removeEventListener('change', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, []);
  return narrow;
}

export function Table({
  rows,
  selected,
  sort,
  onSort,
  onSelect,
  onChart,
  results,
  eps,
}: Props) {
  const narrow = useNarrow();
  if (narrow) {
    return (
      <MobileRows
        rows={rows}
        selected={selected}
        onSelect={onSelect}
        onChart={onChart}
        results={results}
        eps={eps}
      />
    );
  }
  return (
    <div className="table-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="col-rank">#</th>
            <th
              className="col-stock sortable"
              onClick={() => onSort('symbol')}
              aria-sort={sort.key === 'symbol' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              Stock{sortIndicator(sort, 'symbol')}
            </th>
            <th className="col-shift">Structure shift</th>
            <th className="col-level num">Broken level</th>
            <th className="col-shiftclose num">Close @ shift</th>
            <th
              className="col-ltp num sortable"
              onClick={() => onSort('close')}
              aria-sort={sort.key === 'close' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              LTP{sortIndicator(sort, 'close')}
            </th>
            <th className="col-change num">Day %</th>
            <th
              className="col-since num sortable"
              onClick={() => onSort('since')}
              aria-sort={sort.key === 'since' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              Since shift{sortIndicator(sort, 'since')}
            </th>
            <th className="col-structure">Active swing</th>
            <th
              className="col-range"
              title="52-week high/low with today's close, the latest quarterly EPS trend, and the last result date with its quarter end (plus the next meeting once announced)"
            >
              Range · EPS · Qtr
            </th>
            <th className="col-spark">6M</th>
            <th className="col-research" aria-label="Research" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isSelected = selected === row.symbol;
            const insufficient = row.status === 'insufficient';
            const industry = cleanIndustry(row.industry);
            return (
              <tr
                key={row.symbol}
                className={[
                  isSelected ? 'is-selected' : '',
                  insufficient ? 'is-insufficient' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelect(row.symbol)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(row.symbol);
                  }
                }}
                aria-label={`Open details for ${row.symbol}`}
              >
                <td className="col-rank num">{index + 1}</td>
                <td className="col-stock">
                  <div className="stock">
                    <span className="stock__symbol">
                      {row.symbol}
                      {row.status === 'stale' && (
                        <span className="badge badge--stale">stale</span>
                      )}
                    </span>
                    <span className="stock__name">{row.name}</span>
                    {industry && (
                      <span className="stock__industry">{industry}</span>
                    )}
                  </div>
                </td>
                <td className="col-shift">
                  {row.status === 'insufficient' ? (
                    <span className="badge badge--muted">Insufficient history</span>
                  ) : row.direction ? (
                    <div className="shift">
                      <span className={`pill pill--${row.direction}`}>
                        {row.direction === 'bullish' ? 'Bullish' : 'Bearish'}
                      </span>
                      <span className={ageClass(row.barsSince)}>
                        {row.barsSince === 0
                          ? 'This bar'
                          : row.barsSince === 1
                            ? '1 bar ago'
                            : `${row.barsSince} bars ago`}
                      </span>
                      <span className="shift__date">
                        {formatDateShort(row.eventDate)}
                      </span>
                    </div>
                  ) : (
                    <span className="badge badge--muted">No shift</span>
                  )}
                </td>
                <td className="col-level num">
                  {row.level !== null ? formatPrice(row.level) : '—'}
                </td>
                <td className="col-shiftclose num">
                  {row.eventClose !== null ? formatPrice(row.eventClose) : '—'}
                </td>
                <td className="col-ltp num">
                  <div className="ltp">
                    <span>{formatPrice(row.close)}</span>
                  </div>
                </td>
                <td className={`col-change num ${row.changePct === null ? 'flat' : row.changePct > 0 ? 'up' : row.changePct < 0 ? 'down' : 'flat'}`}>
                  {row.changePct === null
                    ? '—'
                    : `${row.changePct > 0 ? '+' : ''}${row.changePct.toFixed(2)}%`}
                </td>
                <td className={`col-since num ${sinceClass(row)}`}>
                  {row.sincePct === null
                    ? '—'
                    : `${row.sincePct > 0 ? '+' : ''}${row.sincePct.toFixed(2)}%`}
                </td>
                <td className="col-structure">
                  {row.activeHigh === null && row.activeLow === null ? (
                    <span className="muted">—</span>
                  ) : (
                    <div className="swing">
                      {row.activeHigh !== null && (
                        <span className="swing__row">
                          <span className="swing__tag swing__tag--res">R</span>
                          {formatPrice(row.activeHigh)}
                        </span>
                      )}
                      {row.activeLow !== null && (
                        <span className="swing__row">
                          <span className="swing__tag swing__tag--sup">S</span>
                          {formatPrice(row.activeLow)}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="col-range">
                  <Trajectory
                    row={row}
                    info={results[row.symbol]}
                    eps={eps[row.symbol]}
                  />
                </td>
                <td className="col-spark">
                  <Sparkline values={row.spark} direction={row.direction} />
                </td>
                <td className="col-research">
                  <ResearchLink symbol={row.symbol} className="row-link" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MobileRows({
  rows,
  selected,
  onSelect,
  onChart,
  results,
  eps,
}: {
  rows: Row[];
  selected: string | null;
  onSelect: (symbol: string) => void;
  onChart: (symbol: string) => void;
  results: Record<string, ResultInfo | null>;
  eps: Record<string, EpsInfo>;
}) {
  const [detailsSymbol, setDetailsSymbol] = useState<string | null>(null);
  const detailsRow = detailsSymbol
    ? (rows.find((item) => item.symbol === detailsSymbol) ?? null)
    : null;

  return (
    <>
    <ul className="mcards" aria-label="Structure shifts">
      {rows.map((row) => {
        const isSelected = selected === row.symbol;
        const insufficient = row.status === 'insufficient';
        return (
          <li
            key={row.symbol}
            className={[
              'mcard',
              isSelected ? 'is-selected' : '',
              insufficient ? 'is-insufficient' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onSelect(row.symbol)}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(row.symbol);
              }
            }}
            aria-label={`Open details for ${row.symbol}`}
          >
            <div className="mcard__main">
              <div className="mcard__body">
                <div className="mcard__top">
                  <span className="mcard__symbol">
                    {row.symbol}
                    {row.status === 'stale' && (
                      <span className="badge badge--stale">stale</span>
                    )}
                  </span>
                  <span className="mcard__price num">
                    {formatPrice(row.close)}
                  </span>
                  <span
                    className={`mcard__chg num ${
                      row.changePct === null
                        ? 'flat'
                        : row.changePct > 0
                          ? 'up'
                          : row.changePct < 0
                            ? 'down'
                            : 'flat'
                    }`}
                  >
                    {pctText(row.changePct)}
                  </span>
                </div>

                {insufficient ? (
                  <div className="mcard__mid">
                    <span className="badge badge--muted">
                      Insufficient history
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="mcard__mid">
                      {row.direction ? (
                        <span className={`pill pill--${row.direction}`}>
                          {row.direction === 'bullish' ? 'Bullish' : 'Bearish'}
                        </span>
                      ) : (
                        <span className="badge badge--muted">No shift</span>
                      )}
                      <span className={ageClass(row.barsSince)}>
                        {ageText(row.barsSince)}
                      </span>
                      <span className="mcard__date">
                        {formatDateShort(row.eventDate)}
                      </span>
                    </div>
                    <div className="mcard__meta">
                      {row.level !== null && (
                        <span>
                          broke <b className="num">{formatPrice(row.level)}</b>
                        </span>
                      )}
                      {row.sincePct !== null && (
                        <span>
                          since{' '}
                          <b className={`num ${sinceClass(row)}`}>
                            {pctText(row.sincePct)}
                          </b>
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="mcard__actions">
                <button
                  type="button"
                  className="mcard__chart"
                  aria-label={`Open ${row.symbol} chart full screen`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onChart(row.symbol);
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="17"
                    height="17"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.35"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2.2 1.9v11.9h11.9" />
                    <path d="M4.6 10.6 7 7.7l2.2 1.9 3.2-4.6" />
                    <path d="M12.4 5h1.9v1.9" />
                  </svg>
                </button>
                <ResearchLink
                  symbol={row.symbol}
                  className="mcard__chart mcard__research"
                  book
                />
              </div>
            </div>

            {!insufficient && (
              <div className="mcard__range">
                <Trajectory
                  row={row}
                  info={results[row.symbol]}
                  eps={eps[row.symbol]}
                  onActivate={() => setDetailsSymbol(row.symbol)}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
    {detailsRow && (
      <IndicatorDialog
        symbol={detailsRow.symbol}
        row={detailsRow}
        info={results[detailsRow.symbol]}
        eps={eps[detailsRow.symbol]}
        onClose={() => setDetailsSymbol(null)}
      />
    )}
    </>
  );
}