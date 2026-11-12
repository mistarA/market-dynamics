import type { Direction } from '../lib/types';

type Props = {
  values: number[];
  direction: Direction | null;
};

export function Sparkline({ values, direction }: Props) {
  if (values.length < 2) {
    return <span className="spark spark--empty">—</span>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 100;
  const height = 26;
  const pad = 2;

  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const stroke =
    direction === 'bullish'
      ? 'var(--up)'
      : direction === 'bearish'
        ? 'var(--down)'
        : 'var(--muted)';

  const last = values[values.length - 1];
  const first = values[0];
  const classSuffix = last > first ? 'up' : last < first ? 'down' : 'flat';

  return (
    <svg
      className={`spark spark--${classSuffix}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        opacity="0.9"
      />
    </svg>
  );
}
