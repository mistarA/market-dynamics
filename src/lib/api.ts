import type {
  EpsInfo,
  IndexDataset,
  IndexInfo,
  Filing,
  ResultDetail,
  ResultInfo,
  ResultSummary,
  Snapshot,
} from './types';

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

type ResultsPayload = {
  results?: Record<string, ResultInfo | null>;
};

/**
 * Result dates for a batch of symbols. Missing or unavailable data is not an
 * error: the row simply renders without the result line.
 */
export async function fetchResults(
  symbols: string[],
): Promise<Record<string, ResultInfo | null>> {
  if (symbols.length === 0) return {};
  try {
    const response = await fetch(
      `/api/results?symbols=${encodeURIComponent(symbols.join(','))}`,
      { cache: 'no-store' },
    );
    if (!response.ok) return {};
    const payload = (await response.json()) as ResultsPayload;
    return payload.results ?? {};
  } catch {
    return {};
  }
}

/** Per-symbol, short-lived browser cache so opening a dialog or hovering a row
 * twice does not re-hit NSE. */
const detailCache = new Map<string, { at: number; detail: ResultDetail }>();
const DETAIL_TTL_MS = 5 * 60 * 1000;

/**
 * The result summary and recent exchange filings for one symbol, loaded only
 * when the hover, mobile dialog or research page asks for them.
 */
export async function fetchResultDetail(
  symbol: string,
): Promise<ResultDetail> {
  const cached = detailCache.get(symbol);
  if (cached && Date.now() - cached.at < DETAIL_TTL_MS) return cached.detail;

  try {
    const response = await fetch(
      `/api/results?detail=1&symbol=${encodeURIComponent(symbol)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) throw new Error(`Detail request failed (${response.status})`);
    const payload = (await response.json()) as {
      summary?: ResultSummary | null;
      filings?: Filing[];
    };
    const detail: ResultDetail = {
      summary: payload.summary ?? null,
      filings: Array.isArray(payload.filings) ? payload.filings : [],
    };
    detailCache.set(symbol, { at: Date.now(), detail });
    return detail;
  } catch {
    return { summary: null, filings: [] };
  }
}

/** Keep each serverless EPS call well inside its execution limit. */
const EPS_CHUNK = 12;

/**
 * Quarterly EPS trends for a batch of symbols. Each symbol costs one filings
 * call plus one XBRL document per quarter, so the batch is split into small
 * parallel requests: a cold cache cannot time out the whole index, and rows
 * fill in as each chunk lands. A failure is silent.
 */
export async function fetchEps(
  symbols: string[],
): Promise<Record<string, EpsInfo>> {
  if (symbols.length === 0) return {};
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += EPS_CHUNK) {
    chunks.push(symbols.slice(i, i + EPS_CHUNK));
  }

  const parts = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const response = await fetch(
          `/api/eps?symbols=${encodeURIComponent(chunk.join(','))}`,
          { cache: 'no-store' },
        );
        if (!response.ok) return {};
        const payload = (await response.json()) as {
          eps?: Record<string, EpsInfo>;
        };
        return payload.eps ?? {};
      } catch {
        return {};
      }
    }),
  );

  return Object.assign({}, ...parts) as Record<string, EpsInfo>;
}
