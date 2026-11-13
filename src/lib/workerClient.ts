import type { WorkerRequest, WorkerResponse } from './messages';
import type {
  AnalysisContext,
  BacktestReport,
  Confirmation,
  Detail,
  IndexDataset,
  Row,
  Snapshot,
  SnapshotIndex,
  SwingMethod,
  Timeframe,
} from './types';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type ComputeResult = { rows: Row[]; computeMs: number };
export type DetailResult = { detail: Detail; computeMs: number };
export type AttachResult = { key: string; symbols: number; fetched: number };

/** Typed promise wrapper around the analysis worker. */
export class AnalysisClient {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private sequence = 0;

  constructor() {
    this.worker = new Worker(
      new URL('../workers/mss.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'ready') return;
      if (message.type === 'error') {
        if (message.requestId !== undefined) {
          this.pending.get(message.requestId)?.reject(new Error(message.message));
          this.pending.delete(message.requestId);
        }
        return;
      }
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      if (message.type === 'computed') {
        pending.resolve({ rows: message.rows, computeMs: message.computeMs });
      } else if (message.type === 'attached') {
        pending.resolve({
          key: message.key,
          symbols: message.symbols,
          fetched: message.fetched,
        });
      } else if (message.type === 'backtested') {
        pending.resolve({
          report: message.report,
          computeMs: message.computeMs,
        });
      } else {
        pending.resolve({ detail: message.detail, computeMs: message.computeMs });
      }
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Analysis worker failed');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  private request<T>(message: WorkerRequest & { requestId?: number }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (message.requestId === undefined) {
        reject(new Error('Request id required'));
        return;
      }
      this.pending.set(message.requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage(message);
    });
  }

  init(snapshot: Snapshot): Promise<{
    version: string;
    asOf: string;
    indices: SnapshotIndex[];
  }> {
    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'ready') {
          this.worker.removeEventListener('message', onMessage);
          resolve(event.data);
        }
        if (event.data.type === 'error') {
          this.worker.removeEventListener('message', onMessage);
          reject(new Error(event.data.message));
        }
      };
      this.worker.addEventListener('message', onMessage);
      this.worker.postMessage({ type: 'init', snapshot } satisfies WorkerRequest);
    });
  }

  attach(dataset: IndexDataset): Promise<AttachResult> {
    this.sequence += 1;
    return this.request<AttachResult>({
      type: 'attach',
      requestId: this.sequence,
      dataset,
    });
  }

  compute(
    indexSlug: string,
    timeframe: Timeframe,
    confirmation: Confirmation,
    method: SwingMethod,
    context: AnalysisContext,
  ): Promise<ComputeResult> {
    this.sequence += 1;
    return this.request<ComputeResult>({
      type: 'compute',
      requestId: this.sequence,
      indexSlug,
      timeframe,
      confirmation,
      method,
      context,
    });
  }

  detail(
    symbol: string,
    timeframe: Timeframe,
    confirmation: Confirmation,
    method: SwingMethod,
    context: AnalysisContext,
  ): Promise<DetailResult> {
    this.sequence += 1;
    return this.request<DetailResult>({
      type: 'detail',
      requestId: this.sequence,
      symbol,
      timeframe,
      confirmation,
      method,
      context,
    });
  }

  backtest(
    indexKey: string,
    symbol: string,
    costsBps: number,
    provisional: boolean,
  ): Promise<{ report: BacktestReport; computeMs: number }> {
    this.sequence += 1;
    return this.request<{ report: BacktestReport; computeMs: number }>({
      type: 'backtest',
      requestId: this.sequence,
      indexKey,
      symbol,
      costsBps,
      provisional,
    });
  }

  terminate(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
