import type { IndexDataset, IndexInfo, Snapshot } from './types';

const SNAPSHOT_URL =
  (import.meta.env.VITE_SNAPSHOT_URL as string | undefined) ||
  '/data/snapshot.json';

/**
 * Fetch the core snapshot. In production this points at Vercel Blob via
 * VITE_SNAPSHOT_URL; in local dev it is the file written by `npm run backfill`.
 */
export async function fetchSnapshot(): Promise<Snapshot> {
  const response = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Snapshot request failed (${response.status})`);
  }
  return (await response.json()) as Snapshot;
}

/**
 * Cheap freshness probe against the serverless function. Absent locally, so
 * every failure is treated as "unknown" and is non-fatal.
 */
export async function fetchServerVersion(): Promise<string | null> {
  try {
    const response = await fetch('/api/version', { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = (await response.json()) as { version?: string };
    return payload.version ?? null;
  } catch {
    return null;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

type IndexPayload = Partial<IndexDataset> & {
  url?: string;
  cached?: boolean;
};

/**
 * Load one non-primary index from the server on demand.
 *
 * On Vercel the function returns a small pointer to a Blob URL so large lazy
 * datasets are CDN-served and avoid the 4.5 MB function response limit. Local
 * dev returns the dataset inline.
 */
export async function fetchIndexDataset(key: string): Promise<IndexDataset> {
  const response = await fetch(`/api/index?key=${encodeURIComponent(key)}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(await readError(response));

  const payload = (await response.json()) as IndexPayload;
  if (payload.url) {
    const datasetResponse = await fetch(payload.url, { cache: 'no-store' });
    if (!datasetResponse.ok) {
      throw new Error(`Index dataset download failed (${datasetResponse.status})`);
    }
    return validateDataset((await datasetResponse.json()) as IndexPayload);
  }
  return validateDataset(payload);
}

function validateDataset(payload: IndexPayload): IndexDataset {
  if (!payload?.index?.symbols || !payload.version || !payload.data) {
    throw new Error('Malformed index response');
  }
  return payload as IndexDataset;
}

/** Full catalogue, used only as a fallback when an old snapshot lacks it. */
export async function fetchIndexCatalogue(): Promise<IndexInfo[]> {
  const response = await fetch('/api/indices', { cache: 'no-store' });
  if (!response.ok) throw new Error(await readError(response));
  const payload = (await response.json()) as { indices?: IndexInfo[] };
  if (!Array.isArray(payload.indices)) throw new Error('Malformed catalogue');
  return payload.indices;
}

export async function triggerRefresh(): Promise<boolean> {
  try {
    const response = await fetch('/api/refresh', { method: 'POST' });
    return response.ok;
  } catch {
    return false;
  }
}
