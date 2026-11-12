import { withRetry } from '../concurrency';

/**
 * Shared NSE HTTP helper.
 *
 * Never send an Origin header: NSE answers `500 {"error":"Not allowd by CORS"}`
 * when one is present. Calls must run server-side.
 */

export const NSE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Referer: 'https://www.nseindia.com/',
  Accept: 'application/json',
};

export type NseRequestOptions = {
  timeoutMs?: number;
  retries?: number;
  label?: string;
};

export async function nseJson<T>(
  url: URL | string,
  options: NseRequestOptions = {},
): Promise<T> {
  const target = typeof url === 'string' ? new URL(url) : url;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const label = options.label ?? target.pathname;

  return withRetry(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(target, {
          headers: NSE_HEADERS,
          signal: controller.signal,
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(
            `NSE ${response.status} for ${label}: ${text.slice(0, 160)}`,
          );
        }
        return (await response.json()) as T;
      } finally {
        clearTimeout(timer);
      }
    },
    {
      retries: options.retries ?? 3,
      onRetry: (attempt) => console.warn(`  retry ${attempt} ${label}`),
    },
  );
}
