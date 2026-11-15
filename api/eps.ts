import { runtime } from '../src/lib/server/runtime.js';
import {
  buildEps,
  isFresh,
  readEpsCache,
  writeEpsCache,
} from '../src/lib/server/eps.js';
import type { EpsInfo } from '../src/lib/types.js';

/**
 * Quarterly EPS trend for a batch of symbols.
 *
 *   GET /api/eps?symbols=DIVISLAB,TCS
 *
 * EPS lives in each filing's XBRL, so the first request for a symbol is slow
 * (one document per quarter). Results are cached in Blob for a week; missing or
 * unparseable symbols are simply omitted rather than reported as zero.
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
  const cache = await readEpsCache(rt);
  const fresh = isFresh(cache);
  const missing = symbols.filter((item) => !fresh || !cache?.eps?.[item]);

  let eps: Record<string, EpsInfo> = cache?.eps ?? {};
  if (missing.length > 0) {
    try {
      const built = await buildEps(missing);
      eps = { ...eps, ...built };
      await writeEpsCache(rt, {
        builtAt: new Date().toISOString(),
        eps,
      });
    } catch (error) {
      console.error('eps: build failed', error);
    }
  }

  const picked: Record<string, EpsInfo> = {};
  for (const item of symbols) {
    const info = eps[item];
    if (info) picked[item] = info;
  }

  res.status(200).json({ eps: picked });
}
