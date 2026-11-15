import { useEffect, useState } from 'react';
import { fetchResultDetail } from '../lib/api';
import { formatDate } from '../lib/date';
import { cleanIndustry, formatPct, formatPrice } from '../lib/format';
import {
  linkHost,
  researchGroups,
  type ResearchGroup,
  type ResearchLink,
} from '../lib/research';
import type { ResultDetail, Row } from '../lib/types';
import { FilingsList } from './FilingsList';

type Props = {
  symbol: string;
  /** The dashboard row for this symbol, when it is in the current index. */
  row: Row | null;
  onClose: () => void;
};

function LinkList({ links }: { links: ResearchLink[] }) {
  return (
    <ul className="research__links">
      {links.map((link) => (
        <li key={link.href}>
          <a href={link.href} target="_blank" rel="noreferrer">
            <span className="research__label">{link.label}</span>
            <span className="research__note">{link.note}</span>
            <span className="research__host">{linkHost(link.href)} ↗</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function GroupCard({ group }: { group: ResearchGroup }) {
  return (
    <section className="research__group">
      <h2>{group.title}</h2>
      <p className="research__hint">{group.hint}</p>
      {group.sections ? (
        <div className="research__sections">
          {group.sections.map((section) => (
            <section className="research__section" key={section.title}>
              <h3>{section.title}</h3>
              <p className="research__hint">{section.hint}</p>
              <LinkList links={section.links} />
            </section>
          ))}
        </div>
      ) : (
        <LinkList links={group.links} />
      )}
    </section>
  );
}

/**
 * Two balanced columns rather than one wide grid row. A single row of cards
 * lets the tallest card (Sentiment) stretch every other card's empty space;
 * independent columns stack naturally, so the page has no dead band.
 */
const PRIMARY_TITLES = ['Quarterly results', 'Sentiment'];
const SECONDARY_TITLES = ['Price chart', 'Analysis', 'Headwind or tailwind'];

/**
 * Dedicated research page for one symbol: everything needed to argue the thesis
 * or to check it against a second source, grouped by the question it answers.
 */
export function ResearchPage({ symbol, row, onClose }: Props) {
  const groups = researchGroups(symbol);
  const [detail, setDetail] = useState<ResultDetail | undefined>(undefined);

  const byTitle = new Map(groups.map((group) => [group.title, group]));
  const pick = (titles: string[]) =>
    titles
      .map((title) => byTitle.get(title))
      .filter((group): group is ResearchGroup => Boolean(group));
  const primary = pick(PRIMARY_TITLES);
  const secondary = pick(SECONDARY_TITLES);

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

  return (
    <div className="research" role="dialog" aria-modal="true" aria-label={`${symbol} research`}>
      <header className="research__head">
        <button className="btn btn--ghost research__back" onClick={onClose}>
          ← Dashboard
        </button>
        <div className="research__id">
          <div className="research__eyebrow">
            {cleanIndustry(row?.industry) ?? 'NSE equity'}
            <span className="dot" />
            {symbol}
          </div>
          <h1>
            {symbol}
            {row?.name && <span className="research__name">{row.name}</span>}
          </h1>
        </div>
        {row && (
          <div className="research__price">
            <strong>{formatPrice(row.close)}</strong>
            <span
              className={
                row.changePct === null
                  ? 'flat'
                  : row.changePct > 0
                    ? 'up'
                    : row.changePct < 0
                      ? 'down'
                      : 'flat'
              }
            >
              {formatPct(row.changePct)}
            </span>
          </div>
        )}
      </header>

      {row && row.direction && (
        <p className="research__thesis">
          <span className={`pill pill--${row.direction}`}>
            {row.direction === 'bullish' ? 'Bullish' : 'Bearish'}
          </span>
          <span>
            broke {formatPrice(row.level)} on {formatDate(row.eventDate)}
          </span>
          <span className={row.sincePct !== null && row.sincePct < 0 ? 'down' : 'up'}>
            {formatPct(row.sincePct)} since
          </span>
          <span className="research__thesis-note">
            Check the numbers below before trusting the break.
          </span>
        </p>
      )}

      <div className="research__layout">
        <div className="research__col">
          <span className="research__col-label">Numbers &amp; sentiment</span>
          {primary.map((group) => (
            <GroupCard key={group.title} group={group} />
          ))}
        </div>
        <div className="research__col">
          <span className="research__col-label">Chart &amp; analysis</span>
          {secondary.map((group) => (
            <GroupCard key={group.title} group={group} />
          ))}
        </div>
      </div>

      <section className="research__filings">
        <h2>Recent exchange filings</h2>
        <p className="research__hint">
          One line per filing: the date, what was filed, and the original NSE
          documents. Quarterly results carry both the PDF and the XBRL.
        </p>
        <FilingsList
          filings={detail?.filings ?? []}
          loading={detail === undefined}
        />
      </section>
    </div>
  );
}
