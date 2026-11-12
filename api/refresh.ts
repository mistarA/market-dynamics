import { put } from '@vercel/blob';
import { buildSnapshot } from '../src/lib/buildSnapshot';
import { runtime } from '../src/lib/server/runtime';
import { readScripcodes, writeScripcodes } from '../src/lib/server/state';
import type { CatalogueCache } from '../src/lib/server/catalogue';

/**
 * Rebuild the core snapshot from the NSE charting API and publish it to Blob.
 *
 * Authorisation: if CRON_SECRET (or REFRESH_SECRET) is configured, callers must
 * present `Authorization: Bearer <secret>`. Vercel Cron does this automatically.
 * Without a configured secret the endpoint refuses to run in production.
 */

type Req = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const SNAPSHOT_PATH = 'snapshots/snapshot.json';
const VERSION_PATH = 'snapshots/version.json';

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method && !['GET', 'POST'].includes(req.method)) {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const local = !token && !process.env.VERCEL;

  if (!token && !local) {
    res.status(503).json({
      error:
        'Blob storage is not configured. Set BLOB_READ_WRITE_TOKEN, or run `npm run backfill` locally.',
    });
    return;
  }

  const secret = process.env.CRON_SECRET ?? process.env.REFRESH_SECRET;
  if (secret) {
    const auth = headerValue(req.headers?.authorization);
    if (auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  } else if (process.env.VERCEL_ENV === 'production') {
    res.status(401).json({
      error: 'Refresh is locked. Set CRON_SECRET to enable scheduled rebuilds.',
    });
    return;
  }

  const started = Date.now();
  const rt = runtime();

  try {
    const scripcodes = await readScripcodes(rt);
    const { snapshot, report } = await buildSnapshot({
      years: 3,
      concurrency: 8,
      writeLocal: local,
      scripcodes,
    });

    if (report.coverage < 0.95) {
      console.error(
        JSON.stringify({
          phase: 'validate',
          ok: false,
          coverage: report.coverage,
          failed: report.failed,
        }),
      );
      res.status(502).json({
        error: 'Snapshot coverage below 95%',
        coverage: report.coverage,
        failed: report.symbols
          .filter((row) => row.error)
          .map((row) => ({ symbol: row.symbol, error: row.error })),
      });
      return;
    }

    const body = JSON.stringify(snapshot);
    const version = {
      version: snapshot.version,
      asOf: snapshot.asOf,
      generatedAt: snapshot.generatedAt,
      symbols: Object.keys(snapshot.symbols).length,
      indices: snapshot.catalogue.length,
      bytes: body.length,
    };

    if (!local) {
      await put(SNAPSHOT_PATH, body, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
      });
      await put(VERSION_PATH, JSON.stringify(version), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        cacheControlMaxAge: 0,
      });
    }

    const catalogueCache: CatalogueCache = {
      generatedAt: snapshot.generatedAt,
      indices: snapshot.catalogue,
    };
    await rt.store.write(rt.path.catalogue, catalogueCache);
    await writeScripcodes(rt, scripcodes);

    const durationMs = Date.now() - started;
    console.log(
      JSON.stringify({
        phase: 'refresh',
        mode: local ? 'local' : 'blob',
        ok: true,
        version: snapshot.version,
        asOf: snapshot.asOf,
        coverage: report.coverage,
        indices: snapshot.catalogue.length,
        fetchMs: report.timings.fetchMs,
        writeMs: report.timings.writeMs,
        durationMs,
        bytes: body.length,
      }),
    );

    res.status(200).json({
      ok: true,
      ...version,
      coverage: report.coverage,
      durationMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ phase: 'refresh', ok: false, error: message }));
    res.status(500).json({ error: message });
  }
}
