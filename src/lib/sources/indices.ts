import { mapPool } from '../concurrency';
import { nseJson } from './nse';
import type { IndexInfo } from '../types';

/**
 * NSE index tracker API.
 *
 *   ?functionName=getAllIndices
 *     -> { data: { "NIFTY 50": { fnoIndexName, indicesLongName, indicesShortName }, ... } }
 *
 *   ?functionName=getConstituents&index=NIFTY%2050&noofrecords=0
 *     -> { data: [{ cmSymbol: "HDFCBANK", weightage, ... }] }
 *
 * JavaScript preserves the insertion order of the catalogue object, which is
 * the order NSE displays. The first four entries become the primary tabs.
 */

const BASE = 'https://www.nseindia.com/api/NextApi/apiClient/indexTrackerApi';
const SYMBOL_PATTERN = /^[A-Z0-9&.-]+$/;

type CatalogueRow = {
  fnoIndexName?: string | null;
  indicesLongName?: string;
  indicesShortName?: string;
};

type CataloguePayload = {
  data?: Record<string, CatalogueRow>;
};

type ConstituentPayload = {
  data?: { cmSymbol?: unknown }[];
};

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Parse and validate getAllIndices, preserving the API's display order. */
export function parseCatalogue(payload: unknown): IndexInfo[] {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Index catalogue is not an object');
  }
  const rows = (payload as CataloguePayload).data;
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) {
    throw new Error('Index catalogue has no data');
  }

  const entries = Object.entries(rows);
  if (entries.length === 0) throw new Error('Index catalogue is empty');

  const used = new Map<string, number>();
  const indices: IndexInfo[] = [];

  for (const [rawKey, row] of entries) {
    const key = rawKey.trim();
    if (!key) throw new Error('Index catalogue has an empty key');

    const name = (row?.indicesLongName ?? key).trim() || key;
    const short = (row?.indicesShortName ?? key).trim() || key;
    const base = slugify(key) || slugify(name) || 'index';
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const slug = seen === 0 ? base : `${base}-${seen + 1}`;

    indices.push({
      key,
      slug,
      name,
      short,
      description: name,
      fno: row?.fnoIndexName ?? null,
    });
  }

  return indices;
}

/** Extract and validate symbols from one getConstituents response. */
export function parseConstituents(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Constituent response is not an object');
  }
  const rows = (payload as ConstituentPayload).data;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Constituent response has no data');
  }

  const symbols: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const raw = row?.cmSymbol;
    if (typeof raw !== 'string') {
      throw new Error('Constituent row is missing cmSymbol');
    }
    const symbol = raw.trim().toUpperCase();
    if (!symbol || !SYMBOL_PATTERN.test(symbol)) {
      throw new Error(`Invalid constituent symbol: ${raw}`);
    }
    if (seen.has(symbol)) {
      throw new Error(`Duplicate constituent symbol: ${symbol}`);
    }
    seen.add(symbol);
    symbols.push(symbol);
  }

  return symbols;
}

export async function fetchCatalogue(): Promise<IndexInfo[]> {
  const url = new URL(BASE);
  url.searchParams.set('functionName', 'getAllIndices');
  const payload = await nseJson<CataloguePayload>(url, {
    label: 'all indices',
  });
  return parseCatalogue(payload);
}

export async function fetchConstituents(indexKey: string): Promise<string[]> {
  const url = new URL(BASE);
  url.searchParams.set('functionName', 'getConstituents');
  url.searchParams.set('index', indexKey);
  url.searchParams.set('noofrecords', '0');
  const payload = await nseJson<ConstituentPayload>(url, {
    label: `constituents ${indexKey}`,
  });
  return parseConstituents(payload);
}

/** Fetch memberships for several indices, keeping catalogue order. */
export async function fetchMemberships(
  indices: IndexInfo[],
  concurrency = 4,
): Promise<{ info: IndexInfo; symbols: string[] }[]> {
  return mapPool(indices, concurrency, async (info) => ({
    info,
    symbols: await fetchConstituents(info.key),
  }));
}

export function unionSymbols(indices: { symbols: string[] }[]): string[] {
  const set = new Set<string>();
  for (const index of indices) {
    for (const symbol of index.symbols) set.add(symbol);
  }
  return [...set].sort();
}
