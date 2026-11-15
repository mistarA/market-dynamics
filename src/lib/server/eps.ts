import { mapPool } from '../concurrency.js';
import { nseJson, nseText } from '../sources/nse.js';
import type { EpsInfo, EpsPoint } from '../types.js';
import type { Runtime } from './runtime.js';

/**
 * Quarterly EPS, parsed from the XBRL attached to each integrated filing.
 *
 * `/api/results-comparision` looks like the obvious source but is frozen at the
 * Dec-2024 quarter, so it cannot be used. The filings payload does list every
 * quarter together with its XBRL URL, and those files carry
 * `BasicEarningsLossPerShareFromContinuingOperations` for the single-quarter
 * context (roughly 90 days) as well as the cumulative ones.
 */

export type EpsCache = {
  builtAt: string;
  eps: Record<string, EpsInfo>;
};

/** EPS history only moves when a company files, so this can be long-lived. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FILINGS_URL =
  'https://www.nseindia.com/api/integrated-filing-results?index=equities&period=Quarterly&symbol=';
/** Enough history for a readable trend without quadrupling the request count. */
const QUARTERS = 4;

type FilingRow = {
  qe_Date?: string;
  xbrl?: string;
  consolidated?: string;
  type_Sub?: string;
};

type FilingsPayload = { data?: FilingRow[] };

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

/** `30-SEP-2026` to `2026-09-30`. */
function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})/.exec(value.trim());
  if (!match) return null;
  const month = MONTHS[match[2].toUpperCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1]}`;
}

function daysBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Context id to its period, for contexts that are close to a single quarter. */
function quarterContexts(xml: string): Set<string> {
  const ids = new Set<string>();
  const pattern =
    /<(?:xbrli:)?context\s+id="([^"]+)"[\s\S]*?<\/(?:xbrli:)?context>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const id = match[1];
    const body = match[0];
    const start = /<(?:xbrli:)?startDate>([^<]+)</.exec(body)?.[1];
    const end = /<(?:xbrli:)?endDate>([^<]+)</.exec(body)?.[1];
    if (!start || !end) continue;
    const span = daysBetween(start.trim(), end.trim());
    if (span >= 80 && span <= 100) ids.add(id);
  }
  return ids;
}

/** The first of several EPS tags that appears for a single-quarter context. */
function readEps(xml: string, contexts: Set<string>): number | null {
  const tags = [
    // Non-banking Ind AS template.
    'BasicEarningsLossPerShareFromContinuingOperations',
    'BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations',
    'BasicEarningsLossPerShare',
    // Banking template uses a different tag family.
    'BasicEarningsPerShareAfterExtraordinaryItems',
    'BasicEarningsPerShareBeforeExtraordinaryItems',
  ];
  for (const tag of tags) {
    const pattern = new RegExp(
      `<(?:[\\w.-]+:)?${tag}\\s+contextRef="([^"]+)"[^>]*>\\s*([-\\d.,]+)`,
    );
    const global = new RegExp(pattern.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = global.exec(xml))) {
      if (!contexts.has(match[1])) continue;
      const value = Number(match[2].replace(/,/g, ''));
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

async function readSymbol(symbol: string): Promise<EpsInfo | null> {
  const payload = await nseJson<FilingsPayload>(
    `${FILINGS_URL}${encodeURIComponent(symbol)}`,
    { label: `eps filings ${symbol}`, retries: 1, timeoutMs: 20_000 },
  );

  // One row per quarter, preferring the consolidated statement when both exist.
  const byPeriod = new Map<string, FilingRow>();
  for (const row of payload.data ?? []) {
    const period = toIsoDate(row.qe_Date);
    if (!period || !row.xbrl) continue;
    const existing = byPeriod.get(period);
    const better =
      !existing ||
      (row.consolidated === 'Consolidated' &&
        existing.consolidated !== 'Consolidated');
    if (better) byPeriod.set(period, row);
  }

  const periods = [...byPeriod.keys()]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, QUARTERS)
    .reverse();

  const points: EpsPoint[] = [];
  for (const period of periods) {
    const url = byPeriod.get(period)?.xbrl;
    if (!url) continue;
    try {
      const xml = await nseText(url, {
        label: `eps xbrl ${symbol} ${period}`,
        retries: 1,
        timeoutMs: 25_000,
      });
      const eps = readEps(xml, quarterContexts(xml));
      if (eps !== null) points.push({ period, eps });
    } catch (error) {
      console.warn(`eps: xbrl failed for ${symbol} ${period}`, error);
    }
  }

  return points.length > 0 ? { points } : null;
}

/** Build EPS trends for the requested symbols. */
export async function buildEps(
  symbols: string[],
): Promise<Record<string, EpsInfo>> {
  const wanted = [
    ...new Set(symbols.map((symbol) => symbol.toUpperCase())),
  ].filter(Boolean);
  if (wanted.length === 0) return {};

  // Each symbol costs one filings call plus one XBRL per quarter, so keep the
  // pool modest to stay clear of NSE's edge throttling.
  const rows = await mapPool(wanted, 4, (symbol) =>
    readSymbol(symbol).catch((error) => {
      console.warn(`eps: failed for ${symbol}`, error);
      return null;
    }),
  );

  const result: Record<string, EpsInfo> = {};
  wanted.forEach((symbol, index) => {
    const info = rows[index];
    if (info) result[symbol] = info;
  });
  return result;
}

export function isFresh(cache: EpsCache | null): boolean {
  if (!cache?.builtAt) return false;
  const age = Date.now() - Date.parse(cache.builtAt);
  return Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS;
}

export async function readEpsCache(rt: Runtime): Promise<EpsCache | null> {
  return rt.store.read<EpsCache>(rt.path.eps);
}

export async function writeEpsCache(
  rt: Runtime,
  cache: EpsCache,
): Promise<void> {
  if (!rt.persist) return;
  await rt.store.write(rt.path.eps, cache);
}
