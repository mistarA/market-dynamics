import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';

export type DarvasBoxRect = {
  /** Date of the earliest pivot in the consolidation. */
  start: string;
  /** Date of the signal bar. */
  end: string;
  top: number;
  bottom: number;
  /** Fill colour for the rectangle body. */
  fill: string;
  /** Colour for the rectangle outline. */
  stroke: string;
};

/**
 * Draws one shaded rectangle per MSS signal, spanning the consolidation range
 * the break came from. Attached to the candlestick series so it follows the
 * price scale and scrolls with the chart.
 */
export class DarvasBoxesPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private readonly _rects: DarvasBoxRect[];
  private readonly _paneViews: DarvasBoxPaneView[];

  constructor(rects: DarvasBoxRect[]) {
    this._rects = rects;
    this._paneViews = [new DarvasBoxPaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart as IChartApi;
    this._series = param.series;
  }

  detached(): void {
    this._chart = null;
    this._series = null;
  }

  get chart(): IChartApi | null {
    return this._chart;
  }

  get series(): ISeriesApi<SeriesType, Time> | null {
    return this._series;
  }

  get rects(): DarvasBoxRect[] {
    return this._rects;
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._paneViews;
  }
}

class DarvasBoxPaneView implements ISeriesPrimitivePaneView {
  private readonly _renderer: DarvasBoxRenderer;

  constructor(source: DarvasBoxesPrimitive) {
    this._renderer = new DarvasBoxRenderer(source);
  }

  /** Keep the boxes behind the candles so price stays readable. */
  zOrder(): 'bottom' {
    return 'bottom';
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return this._renderer;
  }
}

class DarvasBoxRenderer implements ISeriesPrimitivePaneRenderer {
  private readonly _source: DarvasBoxesPrimitive;

  constructor(source: DarvasBoxesPrimitive) {
    this._source = source;
  }

  draw(target: CanvasRenderingTarget2D): void {
    const chart = this._source.chart;
    const series = this._source.series;
    if (!chart || !series) return;

    const timeScale = chart.timeScale();

    target.useMediaCoordinateSpace(({ context: ctx }) => {
      for (const rect of this._source.rects) {
        const xStart = timeScale.timeToCoordinate(rect.start as Time);
        const xEnd = timeScale.timeToCoordinate(rect.end as Time);
        const yTop = series.priceToCoordinate(rect.top);
        const yBottom = series.priceToCoordinate(rect.bottom);
        if (xStart === null || xEnd === null || yTop === null || yBottom === null) {
          continue;
        }

        const left = Math.min(xStart, xEnd);
        const right = Math.max(xStart, xEnd);
        const top = Math.min(yTop, yBottom);
        const bottom = Math.max(yTop, yBottom);
        const width = Math.max(1, right - left);
        const height = Math.max(1, bottom - top);

        ctx.fillStyle = rect.fill;
        ctx.fillRect(left, top, width, height);

        ctx.strokeStyle = rect.stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
      }
    });
  }
}
