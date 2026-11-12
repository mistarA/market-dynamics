import { head } from '@vercel/blob';

/**
 * Cheap freshness probe. Reads a tiny version.json blob written by /api/refresh
 * so clients can compare it with their cached snapshot without downloading the
 * full payload.
 */

type Req = { method?: string; headers?: Record<string, unknown> };
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const VERSION_PATH = 'snapshots/version.json';

export default async function handler(_req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(200).json({ version: null, configured: false });
    return;
  }

  try {
    const blob = await head(VERSION_PATH);
    const response = await fetch(blob.url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`version blob ${response.status}`);
    const payload = (await response.json()) as {
      version?: string;
      asOf?: string;
      generatedAt?: string;
    };
    res.status(200).json({ ...payload, configured: true });
  } catch {
    res.status(200).json({ version: null, configured: true });
  }
}
