import { loadCatalogue } from '../src/lib/server/catalogue';
import { runtime } from '../src/lib/server/runtime';
import { PRIMARY_COUNT } from '../src/lib/buildSnapshot';

/**
 * The complete NSE index catalogue. The client normally reads this from the
 * snapshot; the endpoint exists for currency checks and external consumers.
 */

type Req = { method?: string; url?: string };
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');

  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const refresh = Boolean(req.url && /[?&]refresh=1(?:&|$)/.test(req.url));

  try {
    const indices = await loadCatalogue(runtime(), { refresh });
    res.status(200).json({
      indices,
      primary: indices.slice(0, PRIMARY_COUNT).map((index) => index.key),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ phase: 'indices', ok: false, error: message }));
    res.status(502).json({ error: message });
  }
}
