import { mapPool } from '../concurrency.js';
import { nseText } from '../sources/nse.js';
import type { DeliveryDay, DeliveryInfo } from '../types.js';
import type { Runtime } from './runtime.js';

/**
 * Delivery vs intraday volume, from NSE's daily bhavcopy.
 *
 * `sec_bhavdata_full_<DDMMYYYY>.csv` carries DELIV_QTY, DELIV_PER,
 * TTL_TRD_QNTY and NO_OF_TRADES for every EQ symbol in one ~400 KB file, so
 * seven trading days is seven requests for the whole universe — not per stock.
 * DELIV_PER is delivered quantity as a share of traded quantity; the rest is
 * volume squared off intraday.
 */

export type DeliveryCache = {
  builtAt: string;
  delivery: Record<string, DeliveryInfo>;
};

/** A new bhavcopy appears after each close; six hours is plenty. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DAYS = 7;
/** Look back far enough to skip weekends and exchange holidays. */
const LOOKBACK_DAYS = 16;
const BHAV_URL =
  'https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_';

function labelFor(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  return `${dd}${mm}${yyyy}`;
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** `13-Nov-2026` -> `2026-11-13`. */
function isoFromDate1(value: string): string | null {
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})/.exec(value.trim());
  if (!match) return null;
  const month = MONTHS[match[2].toUpperCase()];
  return month ? `${match[3]}-${month}-${match[1]}` : null;
}

function number(value: string | undefined): number {
  const parsed = Number((value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

type DayRows = { date: string; rows: Map<string, DeliveryDay> };

async function readDay(label: string): Promise<DayRows | null> {
  const text = await nseText(`${BHAV_URL}${label}.csv`, {
    label: `bhavcopy ${label}`,
    retries: 0,
    timeoutMs: 25_000,
  }).catch(() => null);

  // Weekends/holidays return an HTML error page rather than a CSV.
  if (!text || !text.startsWith('SYMBOL')) return null;

  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',').map((part) => part.trim());
  const col = (name: string) => header.indexOf(name);
  const iSymbol = col('SYMBOL');
  const iSeries = col('SERIES');
  const iDate = col('DATE1');
  const iTotal = col('TTL_TRD_QNTY');
  const iDeliv = col('DELIV_QTY');
  const iPer = col('DELIV_PER');
  const iTrades = col('NO_OF_TRADES');
  if (
    iSymbol < 0 ||
    iSeries < 0 ||
    iTotal < 0 ||
    iDeliv < 0 ||
    iPer < 0 ||
    iTrades < 0 ||
    iDate < 0
  ) {
    return null;
  }

  // The archive serves the previous session's file for some missing dates, so
  // trust DATE1 inside the CSV rather than the filename.
  const date = isoFromDate1((lines[1] ?? '').split(',')[iDate] ?? '');
  if (!date) return null;

  const rows = new Map<string, DeliveryDay>();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !line.includes(',')) continue;
    const parts = line.split(',');
    const symbol = (parts[iSymbol] ?? '').trim().toUpperCase();
    if (!symbol || (parts[iSeries] ?? '').trim() !== 'EQ') continue;

    const totalQty = number(parts[iTotal]);
    const deliveryQty = number(parts[iDeliv]);
    const stated = number(parts[iPer]);
    const computed = totalQty > 0 ? (deliveryQty / totalQty) * 100 : 0;
    const deliveryPct = stated > 0 ? stated : computed;
    if (!Number.isFinite(deliveryPct) || deliveryPct <= 0) continue;

    rows.set(symbol, {
      date,
      deliveryPct: Math.round(deliveryPct * 100) / 100,
      intradayPct: Math.round((100 - deliveryPct) * 100) / 100,
      deliveryQty,
      totalQty,
      trades: number(parts[iTrades]),
    });
  }

  return rows.size > 0 ? { date, rows } : null;
}

/** Build the seven-day delivery split for every EQ symbol in the bhavcopies. */
export async function buildDelivery(): Promise<Record<string, DeliveryInfo>> {
  const today = new Date();
  const labels: string[] = [];
  for (let back = 0; back < LOOKBACK_DAYS; back += 1) {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back),
    );
    labels.push(labelFor(date));
  }

  const seenDates = new Set<string>();
  const days = (await mapPool(labels, 5, readDay))
    .filter((day): day is DayRows => day !== null)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .filter((day) => {
      if (seenDates.has(day.date)) return false;
      seenDates.add(day.date);
      return true;
    })
    .slice(0, DAYS)
    .reverse();

  const bySymbol = new Map<string, DeliveryDay[]>();
  for (const day of days) {
    for (const [symbol, value] of day.rows) {
      const list = bySymbol.get(symbol) ?? [];
      list.push(value);
      bySymbol.set(symbol, list);
    }
  }

  const result: Record<string, DeliveryInfo> = {};
  for (const [symbol, values] of bySymbol) {
    result[symbol] = { days: values };
  }
  return result;
}

export function isFresh(cache: DeliveryCache | null): boolean {
  if (!cache?.builtAt) return false;
  const age = Date.now() - Date.parse(cache.builtAt);
  return Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS;
}

export async function readDeliveryCache(
  rt: Runtime,
): Promise<DeliveryCache | null> {
  return rt.store.read<DeliveryCache>(rt.path.delivery);
}

export async function writeDeliveryCache(
  rt: Runtime,
  cache: DeliveryCache,
): Promise<void> {
  if (!rt.persist) return;
  await rt.store.write(rt.path.delivery, cache);
}
