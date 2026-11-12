import { buildIndexDataset } from '../src/lib/buildIndex';
import { loadCatalogue } from '../src/lib/server/catalogue';
import { runtime } from '../src/lib/server/runtime';
import {
  readCoreSnapshot,
  readScripcodes,
  writeScripcodes,
} from '../src/lib/server/state';
import type { IndexDataset } from '../src/lib/types';

/**
 * Load one non-primary index on demand.
 *
 *   GET /api/index?key=NIFTY%20MIDCAP%20100
 *
 * The server reuses bars already in the core snapshot, fetches only missing
 * symbols, and caches the resulting mini-snapshot until the core version
 * changes.
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

function queryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function requestKey(req: Req): string {
  const fromQuery = queryValue(req.query?.key).trim();
  if (fromQuery) return fromQuery;
  if (!req.url) return '';
  try {
    return new URL(req.url, 'http://localhost').searchParams.get('key')?.trim() ?? '';
  } catch {
    return '';
  }
}

function wantsRefresh(req: Req): boolean {
  if (!req.url) return false;
  return /[?&]refresh=1(?:&|$)/.test(req.url);
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const key = requestKey(req);
  if (!key) {
    res.status(400).json({ error: 'Missing index key' });
    return;
  }

  const rt = runtime();
  if (!rt.persist) {
    res.status(503).json({
      error:
        'Index loading needs Blob storage in production. Set BLOB_READ_WRITE_TOKEN.',
    });
    return;
  }

  const started = Date.now();

  try {
    const catalogue = await loadCatalogue(rt);
    const info = catalogue.find((index) => index.key === key);
    if (!info) {
      res.status(404).json({ error: `Unknown index: ${key}` });
      return;
    }

    const core = await readCoreSnapshot(rt);
    if (!core) {
      res.status(503).json({
        error: 'Core snapshot unavailable. Run `npm run backfill` first.',
      });
      return;
    }

    // Version in the pathname makes the cache self-invalidating; the Blob
    // branch can answer with a CDN URL without downloading the dataset.
    const indexPath = rt.path.index(info.slug, core.version);

    if (!wantsRefresh(req)) {
      const url = await rt.store.url(indexPath);
      if (url) {
        res.status(200).json({
          version: core.version,
          asOf: core.asOf,
          key,
          url,
          cached: true,
        });
        return;
      }

      const cached = await rt.store.read<IndexDataset>(indexPath);
      if (
        cached &&
        cached.version === core.version &&
        cached.index.key === key &&
        Array.isArray(cached.index.symbols)
      ) {
        res.status(200).json({ ...cached, cached: true });
        return;
      }
    }

    const scripcodes = await readScripcodes(rt);
    const { dataset, report } = await buildIndexDataset({
      info,
      core,
      scripcodes,
      concurrency: 8,
    });

    if (rt.persist) {
      await rt.store.write(indexPath, dataset);
      await writeScripcodes(rt, scripcodes);
    }

    console.log(
      JSON.stringify({
        phase: 'index',
        ok: true,
        key,
        requested: report.requested,
        reused: report.reused,
        fetched: report.fetched,
        failed: report.failed,
        fetchMs: report.fetchMs,
        durationMs: Date.now() - started,
        bytes: JSON.stringify(dataset).length,
      }),
    );

    const url = await rt.store.url(indexPath);
    if (url) {
      // Keep the function response small; the dataset itself is CDN-served.
      res.status(200).json({
        version: dataset.version,
        asOf: dataset.asOf,
        key: dataset.index.key,
        url,
        cached: false,
        report,
      });
    } else {
      res.status(200).json({ ...dataset, cached: false, report });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ phase: 'index', ok: false, key, error: message }));
    res.status(502).json({ error: message });
  }
}
