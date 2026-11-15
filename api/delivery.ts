import { runtime } from '../src/lib/server/runtime.js';
import {
  buildDelivery,
  isFresh,
  readDeliveryCache,
  writeDeliveryCache,
} from '../src/lib/server/delivery.js';
import type { DeliveryInfo } from '../src/lib/types.js';

/**
 * Seven-day delivery vs intraday split for a batch of symbols.
 *
 *   GET /api/delivery?symbols=DIVISLAB,TCS
 *
 * The seven bhavcopy files cover the whole NSE universe at once, so the whole
 * map is built and cached in Blob for six hours; this endpoint just picks the
 * requested symbols out of it.
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
  const cache = await readDeliveryCache(rt);
  let delivery: Record<string, DeliveryInfo> = cache?.delivery ?? {};

  if (!isFresh(cache) || Object.keys(delivery).length === 0) {
    try {
      delivery = await buildDelivery();
      await writeDeliveryCache(rt, {
        builtAt: new Date().toISOString(),
        delivery,
      });
    } catch (error) {
      console.error('delivery: build failed', error);
    }
  }

  const picked: Record<string, DeliveryInfo> = {};
  for (const symbol of symbols) {
    const info = delivery[symbol];
    if (info) picked[symbol] = info;
  }

  res.status(200).json({ delivery: picked });
}
