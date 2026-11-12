export type PerfMetric = {
  name: string;
  ms: number;
  at: number;
};

const metrics: PerfMetric[] = [];
const debug =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('debug') === '1';

export const PERF_EVENT = 'mss:perf';

export function perfEnabled(): boolean {
  return debug;
}

export function recordMetric(name: string, ms: number): void {
  if (!debug) return;
  metrics.push({ name, ms: Math.round(ms * 10) / 10, at: Date.now() });
  window.dispatchEvent(new CustomEvent(PERF_EVENT));
}

export function getMetrics(): PerfMetric[] {
  return [...metrics];
}

/** Measure a synchronous task. */
export function timed<T>(name: string, task: () => T): T {
  if (!debug) return task();
  const start = performance.now();
  try {
    return task();
  } finally {
    recordMetric(name, performance.now() - start);
  }
}

/** Measure an async task. */
export async function timedAsync<T>(
  name: string,
  task: () => Promise<T>,
): Promise<T> {
  if (!debug) return task();
  const start = performance.now();
  try {
    return await task();
  } finally {
    recordMetric(name, performance.now() - start);
  }
}

export function now(): number {
  return debug ? performance.now() : 0;
}

export function since(name: string, start: number): void {
  if (!debug || !start) return;
  recordMetric(name, performance.now() - start);
}

export const bootAt = typeof performance !== 'undefined' ? performance.now() : 0;
