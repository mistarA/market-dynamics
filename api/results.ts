import { runtime } from '../src/lib/server/runtime';
import {
  buildResults,
  isFresh,
  readResultsCache,
  resultDetail,
  writeResultsCache,
} from '../src/lib/server/results';
import type { ResultDetail, ResultInfo } from '../src/lib/types';

/**
 * Result dates and calendar for a batch of symbols.
 *
 *   GET /api/results?symbols=DIVISLAB,TCS
 *   GET /api/results?symbol=DIVISLAB&detail=1
 *
 * The batch call is cached in Blob for three hours. The `detail` call returns
 * the exchange's prose summary and a feed of filing documents, loaded only on
 * demand and cached per symbol for an hour.
 */

type Req = {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
};

type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const MAX_SYMBOLS = 120;
const DETAIL_TTL_MS = 60 * 60 * 1000;

type DetailCache = {
  entries: Record<string, { at: string; detail: ResultDetail }>;
};

function requestParams(req: Req): URLSearchParams {
  if (req.url) {
    try {
      return new URL(req.url, 'http://localhost').searchParams;
    } catch {
      // fall through to query
    }
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query ?? {})) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) params.set(key, first);
  }
  return params;
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const params = requestParams(req);
  const symbol = (params.get('symbol') ?? '').trim().toUpperCase();

  if (params.get('detail') && symbol) {
    try {
      const rt = runtime();
      const cache = await rt.store.read<DetailCache>(rt.path.details);
      const entry = cache?.entries?.[symbol];
      if (
        entry &&
        Date.now() - Date.parse(entry.at) < DETAIL_TTL_MS &&
        Number.isFinite(Date.parse(entry.at))
      ) {
        res.status(200).json({ symbol, ...entry.detail });
        return;
      }

      const detail = await resultDetail(symbol);
      if (rt.persist) {
        await rt.store.write(rt.path.details, {
          entries: { ...(cache?.entries ?? {}), [symbol]: { at: new Date().toISOString(), detail } },
        } as DetailCache);
      }
      res.status(200).json({ symbol, ...detail });
    } catch (error) {
      console.warn(`results: detail failed for ${symbol}`, error);
      res.status(200).json({ symbol, summary: null, filings: [] });
    }
    return;
  }

  const symbols = (params.get('symbols') ?? '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  if (symbols.length === 0) {
    res.status(400).json({ error: 'symbols is required' });
    return;
  }

  const rt = runtime();
  const cache = await readResultsCache(rt);
  const fresh = isFresh(cache);
  const missing = symbols.filter(
    (item) => !fresh || !cache?.results?.[item],
  );

  let results: Record<string, ResultInfo> = cache?.results ?? {};
  if (missing.length > 0) {
    try {
      const built = await buildResults(missing);
      results = { ...results, ...built };
      await writeResultsCache(rt, {
        builtAt: new Date().toISOString(),
        results,
      });
    } catch (error) {
      console.error('results: build failed', error);
    }
  }

  // Only return what actually resolved, so a failed symbol stays blank rather
  // than claiming the company has no filings.
  const picked: Record<string, ResultInfo> = {};
  for (const item of symbols) {
    const info = results[item];
    if (info) picked[item] = info;
  }

  res.status(200).json({
    builtAt: cache?.builtAt ?? null,
    results: picked,
  });
}
