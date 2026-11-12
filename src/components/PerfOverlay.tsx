import { useEffect, useState } from 'react';
import {
  PERF_EVENT,
  getMetrics,
  perfEnabled,
  type PerfMetric,
} from '../lib/perf';

export function PerfOverlay() {
  const [metrics, setMetrics] = useState<PerfMetric[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!perfEnabled()) return;
    const update = () => setMetrics(getMetrics());
    update();
    window.addEventListener(PERF_EVENT, update);
    return () => window.removeEventListener(PERF_EVENT, update);
  }, []);

  if (!perfEnabled() || metrics.length === 0) return null;

  return (
    <div className={`perf ${open ? 'perf--open' : ''}`}>
      <button className="perf__toggle" onClick={() => setOpen((value) => !value)}>
        <span className="perf__dot" />
        load timings
        <span className="perf__count">{metrics.length}</span>
      </button>
      {open && (
        <ul className="perf__list">
          {metrics.map((metric, index) => (
            <li key={`${metric.name}-${index}`}>
              <span>{metric.name}</span>
              <span className="num">
                {metric.ms >= 1000
                  ? `${(metric.ms / 1000).toFixed(2)}s`
                  : `${metric.ms.toFixed(1)}ms`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
