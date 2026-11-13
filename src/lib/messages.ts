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

export type WorkerRequest =
  | { type: 'init'; snapshot: Snapshot }
  | { type: 'attach'; requestId: number; dataset: IndexDataset }
  | {
      type: 'compute';
      requestId: number;
      indexSlug: string;
      timeframe: Timeframe;
      confirmation: Confirmation;
      method: SwingMethod;
      context: AnalysisContext;
    }
  | {
      type: 'detail';
      requestId: number;
      symbol: string;
      timeframe: Timeframe;
      confirmation: Confirmation;
      method: SwingMethod;
      context: AnalysisContext;
    }
  | {
      type: 'backtest';
      requestId: number;
      indexKey: string;
      symbol: string;
      costsBps: number;
      provisional: boolean;
    };

export type WorkerResponse =
  | {
      type: 'ready';
      version: string;
      asOf: string;
      indices: SnapshotIndex[];
    }
  | {
      type: 'attached';
      requestId: number;
      key: string;
      symbols: number;
      fetched: number;
    }
  | {
      type: 'computed';
      requestId: number;
      rows: Row[];
      computeMs: number;
    }
  | {
      type: 'detail';
      requestId: number;
      detail: Detail;
      computeMs: number;
    }
  | {
      type: 'backtested';
      requestId: number;
      report: BacktestReport;
      computeMs: number;
    }
  | {
      type: 'error';
      requestId?: number;
      message: string;
    };
