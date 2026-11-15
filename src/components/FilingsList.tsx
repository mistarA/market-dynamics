import { formatDateShort } from '../lib/date';
import type { Filing } from '../lib/types';

type Props = {
  filings: Filing[];
  /** Cap the number of rows (the hover shows fewer than the dialog). */
  limit?: number;
  loading?: boolean;
};

/**
 * One line per exchange filing: date, what was filed, and the original NSE
 * documents. Used in the hover, the mobile dialog and the research page.
 */
export function FilingsList({ filings, limit, loading = false }: Props) {
  if (loading && filings.length === 0) {
    return <p className="muted">Loading exchange filings…</p>;
  }
  if (filings.length === 0) {
    return <p className="muted">No filings available.</p>;
  }

  const shown = limit ? filings.slice(0, limit) : filings;
  return (
    <ul className="filings">
      {shown.map((item, index) => (
        <li className="filings__row" key={`${item.date}-${item.title}-${index}`}>
          <span className="filings__date">{formatDateShort(item.date)}</span>
          <span className="filings__title" title={item.title}>
            {item.title}
          </span>
          <span className="filings__docs">
            {item.pdf && (
              <a href={item.pdf} target="_blank" rel="noreferrer">
                PDF ↗
              </a>
            )}
            {item.xbrl && (
              <a href={item.xbrl} target="_blank" rel="noreferrer">
                XBRL ↗
              </a>
            )}
            {!item.pdf && !item.xbrl && <span className="muted">—</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
