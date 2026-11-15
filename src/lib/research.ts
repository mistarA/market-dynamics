/**
 * Second-level research links for one symbol.
 *
 * Everything here is built from the NSE ticker alone so it works for any row in
 * the snapshot without a lookup table. Each group answers one question behind a
 * trade: what did the company just report, what does the chart look like
 * elsewhere, what is being said, and is the business a headwind or a tailwind?
 */

export type ResearchLink = {
  label: string;
  href: string;
  note: string;
};

export type ResearchSection = {
  title: string;
  hint: string;
  links: ResearchLink[];
};

export type ResearchGroup = {
  title: string;
  hint: string;
  links: ResearchLink[];
  /** Optional sub-sections; Sentiment splits live chatter from written news. */
  sections?: ResearchSection[];
};

/** Host without the `www.` prefix, for the small label on each card. */
export function linkHost(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

export function researchGroups(symbol: string): ResearchGroup[] {
  const sym = encodeURIComponent(symbol);
  const upper = symbol.toUpperCase();
  /** Lower-case, URL-safe form used by news tag/topic URLs. */
  const slug = upper.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const query = encodeURIComponent(`${upper} headwinds tailwinds analysis`);

  return [
    {
      title: 'Quarterly results',
      hint: 'The last quarter against the ones before it, plus the filings behind the numbers.',
      links: [
        {
          label: 'Last vs prior quarters',
          href: `https://www.screener.in/company/${sym}/consolidated/#quarters`,
          note: 'Eight quarters side by side — sales, expenses, operating profit, net profit, EPS. Look for a rising or fading trend, not one quarter.',
        },
        {
          label: 'Filings and board meetings',
          href: `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${sym}`,
          note: 'Official result filings and the board-meeting dates that announce them. The next date is the event risk on the chart.',
        },
      ],
    },
    {
      title: 'Price chart',
      hint: 'The same symbol drawn by someone else, for a second opinion on the structure.',
      links: [
        {
          label: `Candles · TradingView ${upper}`,
          href: `https://www.tradingview.com/chart/?symbol=NSE%3A${sym}`,
          note: 'Daily candles with volume. Overlay your own levels and see whether the break holds outside this detection.',
        },
      ],
    },
    {
      title: 'Sentiment',
      hint: 'What is being said right now, split between live chatter and written coverage.',
      links: [],
      sections: [
        {
          title: 'Live search',
          hint: 'Fresh, unfiltered chatter as it happens.',
          links: [
            {
              label: `Live search · #${upper}`,
              href: `https://x.com/search?q=%23${sym}&f=live`,
              note: 'Hashtag search on X. Indian market chatter uses #TICKER rather than the US-style $ cashtag — fastest way to catch a fresh headline, an analyst note, or a result-day reaction.',
            },
          ],
        },
        {
          title: 'News',
          hint: 'Headlines already generated, plus the desks that wrote them.',
          links: [
            {
              label: 'Google News · headlines',
              href: `https://www.google.com/search?q=${sym}+stock+news&tbm=nws`,
              note: 'Aggregated headlines already written about this ticker. Quickest read of what moved the stock and why.',
            },
            {
              label: 'Moneycontrol · news tag',
              href: `https://www.moneycontrol.com/news/tags/${slug}.html`,
              note: 'Moneycontrol’s own tag page for the company — result coverage, broker calls and management commentary.',
            },
            {
              label: 'Economic Times · topic',
              href: `https://economictimes.indiatimes.com/topic/${slug}`,
              note: 'ET’s running topic feed: filings, policy news and sector stories mentioning the company.',
            },
            {
              label: 'Yahoo Finance · news',
              href: `https://finance.yahoo.com/quote/${upper}.NS/news/`,
              note: 'NSE quote’s news tab, mixing wire stories with exchange filings in one stream.',
            },
          ],
        },
      ],
    },
    {
      title: 'Analysis',
      hint: 'Three independent reads of the numbers and the business, in order.',
      links: [
        {
          label: 'Trendlyne · SWOT and forecasts',
          href: `https://trendlyne.com/equity/${upper}/${slug}/`,
          note: 'SWOT, analyst forecasts, peer comparison and checklists. The ticker in the URL resolves to the right equity page.',
        },
        {
          label: 'Screener · fundamentals',
          href: `https://www.screener.in/company/${sym}/consolidated/`,
          note: 'Growth, ROE, debt and the site’s own pros and cons list. A structural break with improving numbers is a different trade from one against them.',
        },
        {
          label: 'StockScans · quarterly results',
          href: `https://www.stockscans.in/company/NSE:${upper}#quarterly-results`,
          note: 'Quarterly results, growth and ratios for this NSE ticker. Remove the #quarterly-results fragment for the whole-company view.',
        },
      ],
    },
    {
      title: 'Headwind or tailwind',
      hint: 'Whether the business is pushing with the trade or against it.',
      links: [
        {
          label: 'Overview and analyst view',
          href: `https://www.google.com/finance/quote/${sym}:NSE`,
          note: 'Valuation, analyst consensus and the recent price context in one screen.',
        },
        {
          label: 'Broker notes',
          href: `https://www.google.com/search?q=${query}`,
          note: 'Surfaces broker reports and result commentary that the ratios alone miss.',
        },
      ],
    },
  ];
}
