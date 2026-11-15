import { mapPool } from '../concurrency.js';
import { nseJson } from '../sources/nse.js';
import { formatDate } from '../date.js';
import type { Filing, ResultDetail, ResultInfo, ResultSummary } from '../types.js';
import type { Runtime } from './runtime.js';

/**
 * Result dates for one symbol, sourced from NSE.
 *
 * Two endpoints are involved:
 *   - `/api/event-calendar` lists upcoming board meetings for every company
 *     (roughly a three-week horizon), which gives the *next* result date.
 *   - `/api/integrated-filing-results?symbol=` lists that company's last twenty
 *     quarterly filings, which gives the *last* result date and the quarters
 *     behind it.
 *
 * Numbers are not in these payloads; they live in the XBRL/PDF attachments.
 * `resultDetail` below returns the prose summary and a feed of filing docs.
 */
export type ResultsCache = {
  builtAt: string;
  results: Record<string, ResultInfo>;
};

// Board-meeting dates appear within a few weeks of the meeting, so keep the
// cache short enough that a newly announced date shows up the same day.
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const CALENDAR_URL = 'https://www.nseindia.com/api/event-calendar?index=equities';
const FILINGS_URL =
  'https://www.nseindia.com/api/integrated-filing-results?index=equities&period=Quarterly&symbol=';
const ANNOUNCEMENTS_URL =
  'https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=';

const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

/** `30-SEP-2026` or `07-Nov-2026 16:56:55` to `2026-09-30`. */
export function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})/.exec(value.trim());
  if (!match) return null;
  const month = MONTHS[match[2].toUpperCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1]}`;
}

type CalendarEntry = {
  symbol?: string;
  purpose?: string;
  date?: string;
};

type FilingEntry = {
  symbol?: string;
  qe_Date?: string;
  broadcast_Date?: string;
  consolidated?: string;
  pdf_attach?: string;
  xbrl?: string;
  type?: string;
  type_Sub?: string;
};

type FilingsPayload = { data?: FilingEntry[] };

type AnnouncementEntry = {
  an_dt?: string;
  desc?: string;
  attchmntText?: string;
  attchmntFile?: string;
  voiceSummary?: string;
};

/** Upcoming board meetings, keyed by symbol. */
async function readCalendar(): Promise<Map<string, CalendarEntry>> {
  const map = new Map<string, CalendarEntry>();
  try {
    const entries = await nseJson<CalendarEntry[]>(CALENDAR_URL, {
      label: 'event-calendar',
      retries: 2,
      timeoutMs: 20_000,
    });
    for (const entry of entries) {
      if (!entry.symbol) continue;
      const symbol = entry.symbol.toUpperCase();
      const existing = map.get(symbol);
      // Keep the earliest upcoming meeting when a company appears twice.
      if (existing && (existing.date ?? '') <= (entry.date ?? '')) continue;
      map.set(symbol, entry);
    }
  } catch (error) {
    console.warn('results: calendar failed', error);
  }
  return map;
}

async function readSymbol(
  symbol: string,
  calendar: Map<string, CalendarEntry>,
): Promise<ResultInfo> {
  const empty: ResultInfo = {
    lastPeriod: null,
    lastFiled: null,
    quarters: [],
    nextDate: null,
    nextPurpose: null,
  };

  const meeting = calendar.get(symbol);
  if (meeting) {
    empty.nextDate = toIsoDate(meeting.date);
    empty.nextPurpose = meeting.purpose ?? null;
  }

  try {
    const payload = await nseJson<FilingsPayload>(
      `${FILINGS_URL}${encodeURIComponent(symbol)}`,
      { label: `filings ${symbol}`, retries: 1, timeoutMs: 20_000 },
    );
    const rows = payload.data ?? [];
    const seen = new Set<string>();
    const quarters: string[] = [];
    for (const row of rows) {
      const period = toIsoDate(row.qe_Date);
      if (!period || seen.has(period)) continue;
      seen.add(period);
      quarters.push(period);
    }
    quarters.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    empty.quarters = quarters.slice(0, 6);
    empty.lastPeriod = quarters[0] ?? null;
    const latest = rows.find((row) => toIsoDate(row.qe_Date) === quarters[0]);
    empty.lastFiled = toIsoDate(latest?.broadcast_Date) ?? null;
  } catch (error) {
    console.warn(`results: filings failed for ${symbol}`, error);
  }

  return empty;
}

/** Build result dates for the requested symbols, reusing one calendar call. */
export async function buildResults(
  symbols: string[],
): Promise<Record<string, ResultInfo>> {
  const wanted = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].filter(
    Boolean,
  );
  if (wanted.length === 0) return {};

  const calendar = await readCalendar();
  const rows = await mapPool(wanted, 4, (symbol) => readSymbol(symbol, calendar));
  return Object.fromEntries(wanted.map((symbol, index) => [symbol, rows[index]]));
}

export function isFresh(cache: ResultsCache | null): boolean {
  if (!cache?.builtAt) return false;
  const age = Date.now() - Date.parse(cache.builtAt);
  return Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS;
}

export async function readResultsCache(rt: Runtime): Promise<ResultsCache | null> {
  return rt.store.read<ResultsCache>(rt.path.results);
}

export async function writeResultsCache(
  rt: Runtime,
  cache: ResultsCache,
): Promise<void> {
  if (!rt.persist) return;
  await rt.store.write(rt.path.results, cache);
}

/**
 * Everything loaded on demand for one symbol: the exchange's prose summary of
 * the latest result, plus a short feed of recent filings with document links.
 *
 * Two NSE calls feed this — corporate announcements (all filings, with their
 * PDFs) and integrated financial results (quarterly results, with PDF + XBRL).
 * The hover, mobile dialog and research page all share this one response.
 */
export async function resultDetail(symbol: string): Promise<ResultDetail> {
  const sym = encodeURIComponent(symbol);
  const [announcements, filingsPayload] = await Promise.all([
    nseJson<AnnouncementEntry[]>(`${ANNOUNCEMENTS_URL}${sym}`, {
      label: `announcements ${symbol}`,
      retries: 1,
      timeoutMs: 25_000,
    }).catch((error) => {
      console.warn(`results: announcements failed for ${symbol}`, error);
      return [] as AnnouncementEntry[];
    }),
    nseJson<FilingsPayload>(`${FILINGS_URL}${sym}`, {
      label: `filing docs ${symbol}`,
      retries: 1,
      timeoutMs: 20_000,
    }).catch((error) => {
      console.warn(`results: filing docs failed for ${symbol}`, error);
      return {} as FilingsPayload;
    }),
  ]);

  // --- prose summary -----------------------------------------------------
  const candidates = announcements.filter((entry) => {
    const text = `${entry.desc ?? ''} ${entry.attchmntText ?? ''}`.toLowerCase();
    return (
      text.includes('financial result') ||
      text.includes('outcome of board') ||
      text.includes('result')
    );
  });
  // NSE writes a prose summary for some filers only. Prefer it, but fall back
  // to the exchange's own filing description so every row has something to say.
  const match =
    candidates.find((entry) => Boolean(entry.voiceSummary)) ?? candidates[0];
  const text = match?.voiceSummary ?? match?.attchmntText ?? null;
  const summary: ResultSummary | null =
    match && text
      ? {
          date: toIsoDate(match.an_dt),
          title: match.desc ?? 'Announcement',
          summary: text,
          attachment: match.attchmntFile ?? null,
        }
      : null;

  // --- quarterly result documents ---------------------------------------
  const resultDocs: Filing[] = [];
  const seen = new Set<string>();
  for (const row of filingsPayload.data ?? []) {
    // Governance filings carry a qe_Date too, but they are not results.
    if ((row.type ?? '').toLowerCase().includes('governance')) continue;
    const date = toIsoDate(row.broadcast_Date);
    if (!date) continue;
    const period = toIsoDate(row.qe_Date);
    const key = `${date}|${period}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resultDocs.push({
      date,
      period,
      title: period
        ? `Results · qtr ended ${formatDate(period)}`
        : 'Financial results',
      kind: 'result',
      pdf: row.pdf_attach ?? null,
      xbrl: row.xbrl ?? null,
    });
  }

  // --- any other recent exchange filing ---------------------------------
  const otherDocs: Filing[] = [];
  for (const entry of announcements) {
    if (!entry.attchmntFile) continue;
    const date = toIsoDate(entry.an_dt);
    if (!date) continue;
    otherDocs.push({
      date,
      period: null,
      title: entry.desc ?? 'Exchange filing',
      kind: 'filing',
      pdf: entry.attchmntFile,
      xbrl: null,
    });
    if (otherDocs.length >= 8) break;
  }

  const filings = [...resultDocs, ...otherDocs]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .filter(
      (item, index, all) =>
        all.findIndex(
          (other) => other.date === item.date && other.pdf === item.pdf,
        ) === index,
    )
    .slice(0, 10);

  return { summary, filings };
}
