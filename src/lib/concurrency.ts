/** Run `fn` over `items` with a bounded number of concurrent workers. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };

  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
};

/**
 * Retry an async task with exponential backoff and jitter.
 * Retries everything by default; callers pass a narrower task when needed.
 */
export async function withRetry<T>(
  task: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const base = options.baseDelayMs ?? 400;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      options.onRetry?.(attempt + 1, error);
      const delay = base * 2 ** attempt + Math.random() * base;
      await sleep(delay);
    }
  }

  throw lastError;
}
