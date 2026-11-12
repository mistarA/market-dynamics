import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { put } from '@vercel/blob';
import type { Snapshot } from '../src/lib/types';

/**
 * Publish the snapshot produced by `npm run backfill` to Vercel Blob.
 * Used for the first deploy (and as a manual fallback), before cron is warm.
 *
 *   BLOB_READ_WRITE_TOKEN=... npm run publish:snapshot
 */

const SNAPSHOT_PATH = 'snapshots/snapshot.json';
const VERSION_PATH = 'snapshots/version.json';
const CATALOGUE_PATH = 'state/catalogue.json';
const SCRIPCODES_PATH = 'state/scripcodes.json';

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(resolve(process.cwd(), path), 'utf8');
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set');
  }

  const raw = await readFile(
    resolve(process.cwd(), 'public/data/snapshot.json'),
    'utf8',
  );
  const snapshot = JSON.parse(raw) as Snapshot;

  const version = {
    version: snapshot.version,
    asOf: snapshot.asOf,
    generatedAt: snapshot.generatedAt,
    symbols: Object.keys(snapshot.symbols).length,
    indices: snapshot.catalogue.length,
    bytes: raw.length,
  };

  const snapshotBlob = await put(SNAPSHOT_PATH, raw, {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  });
  const versionBlob = await put(VERSION_PATH, JSON.stringify(version), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    cacheControlMaxAge: 0,
  });

  const catalogue = await readOptional('data/cache/catalogue.json');
  if (catalogue) {
    await put(CATALOGUE_PATH, catalogue, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: 0,
    });
  }

  const scripcodes = await readOptional('data/cache/scripcodes.json');
  if (scripcodes) {
    await put(SCRIPCODES_PATH, scripcodes, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: 0,
    });
  }

  console.log(`Published ${snapshot.version} (${(raw.length / 1024).toFixed(0)} KB)`);
  console.log(`  indices   ${snapshot.catalogue.length}`);
  console.log(`  snapshot  ${snapshotBlob.url}`);
  console.log(`  version   ${versionBlob.url}`);
  if (!catalogue) {
    console.log('  catalogue skipped (run npm run backfill first)');
  }
  if (!scripcodes) {
    console.log('  scripcodes skipped (run npm run backfill first)');
  }
  console.log(`\nSet VITE_SNAPSHOT_URL=${snapshotBlob.url} before building.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
