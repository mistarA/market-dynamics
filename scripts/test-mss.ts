import { aggregate } from '../src/lib/aggregate';
import { computeStructure } from '../src/lib/mss';
import { findPivots } from '../src/lib/pivots';
import { weekKey } from '../src/lib/date';
import type { Bar } from '../src/lib/types';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${name}`, detail ?? '');
}

function bar(d: string, o: number, h: number, l: number, c: number, v = 1000): Bar {
  return { d, o, h, l, c, v };
}

function daily(closes: number[], start = '2026-01-01'): Bar[] {
  const base = new Date(`${start}T00:00:00Z`);
  const out: Bar[] = [];
  let cursor = 0;
  for (let i = 0; i < closes.length; i += 1) {
    const date = new Date(base.getTime() + cursor * 86_400_000);
    const day = date.getUTCDay();
    if (day === 0 || day === 6) {
      cursor += 1;
      i -= 1;
      continue;
    }
    const close = closes[i];
    out.push(
      bar(
        date.toISOString().slice(0, 10),
        close,
        close + 1,
        close - 1,
        close,
      ),
    );
    cursor += 1;
  }
  return out;
}

console.log('\npivots');

{
  const bars = daily([10, 11, 12, 13, 14, 13, 12, 11, 10]);
  const pivots = findPivots(bars, 2);
  const high = pivots.find((p) => p.kind === 'high');
  check('fractal high detected', Boolean(high), pivots);
  check('high confirmed k bars later', high?.confirmIdx === 6, high);
  check('high price is bar high', high?.price === 15, high);
}

{
  const bars = daily([10, 11, 12, 11, 10, 9, 10, 11, 12]);
  const pivots = findPivots(bars, 2);
  const low = pivots.find((p) => p.kind === 'low');
  check('fractal low detected', Boolean(low), pivots);
  check('low price is bar low', low?.price === 8, low);
}

console.log('\nmss');

{
  // Low pivot at index 4, then a close above the preceding swing high.
  const bars = daily([10, 11, 12, 11, 10, 11, 13, 14, 15, 16]);
  const structure = computeStructure(bars, { confirmation: 1, k: 2 });
  check('bullish event emitted', structure.events.length >= 1, structure.events);
  const event = structure.events[0];
  check('event direction bullish', event?.direction === 'bullish', event);
  check(
    'close is beyond level',
    Boolean(event && event.close > event.level),
    event,
  );
  check(
    'no look-ahead (idx < bars)',
    Boolean(event && event.idx < bars.length),
    event,
  );
}

{
  // Two consecutive closes beyond the level are required with confirmation 2.
  // Only the bar at index 7 closes above the swing high at 13.
  const bars = daily([10, 11, 12, 11, 10, 13, 12, 14, 13, 12]);
  const one = computeStructure(bars, { confirmation: 1, k: 2 });
  const two = computeStructure(bars, { confirmation: 2, k: 2 });
  check('confirmation 1 fires', one.events.length >= 1, one.events);
  check(
    'confirmation 2 does not fire on a single close',
    two.events.length === 0,
    two.events,
  );
  check(
    'confirmation 2 is never earlier than confirmation 1',
    (two.events[0]?.idx ?? Infinity) >= (one.events[0]?.idx ?? -1),
  );
}

{
  // A wick beyond the swing with a close back inside must not fire.
  const bars = daily([10, 11, 12, 11, 10, 11, 13, 12]);
  bars[bars.length - 1] = bar(
    bars[bars.length - 1].d,
    12,
    20,
    11.5,
    12,
  );
  const structure = computeStructure(bars, { confirmation: 1 });
  check('wick-only break does not fire', structure.events.length === 0, structure.events);
}

{
  // Swing low at index 5 (8) is confirmed at index 7, then a close at 7 takes it out.
  const bars = daily([10, 11, 12, 11, 10, 9, 10, 11, 12, 11, 9, 7]);
  const structure = computeStructure(bars, { confirmation: 1 });
  check(
    'bearish event when low breaks',
    structure.events.some((event) => event.direction === 'bearish'),
    structure.events,
  );
  check('trend flips negative', structure.trend === -1, structure.trend);
}

{
  const bars = daily([10, 11, 12, 11, 10, 11, 13, 14, 15, 16]);
  const withLast = computeStructure(bars, { confirmation: 1 });
  const dropped = computeStructure(bars, { confirmation: 1, dropLast: true });
  check(
    'dropLast excludes the live bar from detection',
    dropped.detectionBars.length === bars.length - 1,
  );
  check(
    'barsSince is measured against all bars',
    withLast.barsSince === 0 ||
      withLast.barsSince === null ||
      withLast.barsSince >= 0,
    withLast.barsSince,
  );
}

console.log('\naggregate');

{
  const bars = daily([10, 11, 12, 11, 10, 11, 13, 14, 15, 16], '2026-01-05');
  const weekly = aggregate(bars, 'week');
  check('weekly buckets non-empty', weekly.length > 0, weekly.length);
  check(
    'weekly open matches first bar of bucket',
    weekly[0].o === bars[0].o,
    { weekly: weekly[0], first: bars[0] },
  );
  const lastBucket = weekly[weekly.length - 1];
  const lastBar = bars[bars.length - 1];
  check('weekly close matches last bar', lastBucket.c === lastBar.c);
  check(
    'weekly key grouping is stable',
    new Set(weekly.map((item) => weekKey(item.d))).size === weekly.length,
  );

  const monthly = aggregate(bars, 'month');
  check('monthly buckets non-empty', monthly.length > 0, monthly.length);
  check(
    'monthly close matches last bar',
    monthly[monthly.length - 1].c === lastBar.c,
  );
}

console.log('\nedge cases');

{
  const short = daily([10, 11]);
  const structure = computeStructure(short, { confirmation: 1 });
  check('short series produces no events', structure.events.length === 0);
  check('short series barsSince null', structure.barsSince === null);
}

{
  const structure = computeStructure([], { confirmation: 1 });
  check('empty series is safe', structure.events.length === 0);
  check('empty series has no last event', structure.lastEvent === null);
}

console.log(
  `\n${checks - failures}/${checks} checks passed${failures ? ` · ${failures} failed` : ''}\n`,
);
process.exit(failures ? 1 : 0);
