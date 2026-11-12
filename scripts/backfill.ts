import { buildSnapshot } from '../src/lib/buildSnapshot';
import { runtime } from '../src/lib/server/runtime';
import type { CatalogueCache } from '../src/lib/server/catalogue';
import { readScripcodes, writeScripcodes } from '../src/lib/server/state';

type Args = {
  years: number;
  concurrency: number;
  allowPartial: boolean;
  quiet: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    years: 3,
    concurrency: 8,
    allowPartial: false,
    quiet: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--years=')) args.years = Number(arg.split('=')[1]);
    else if (arg.startsWith('--concurrency='))
      args.concurrency = Number(arg.split('=')[1]);
    else if (arg === '--allow-partial') args.allowPartial = true;
    else if (arg === '--quiet') args.quiet = true;
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const rt = runtime();
  const scripcodes = await readScripcodes(rt);

  const { snapshot, report } = await buildSnapshot({
    years: args.years,
    concurrency: args.concurrency,
    scripcodes,
    onProgress: (done, total, symbol) => {
      if (args.quiet) return;
      if (done % 10 === 0 || done === total) {
        process.stdout.write(`\r  fetched ${done}/${total} · ${symbol}   `);
      }
    },
  });
  if (!args.quiet) process.stdout.write('\n');

  await writeScripcodes(rt, scripcodes);
  if (rt.persist) {
    const catalogue: CatalogueCache = {
      generatedAt: snapshot.generatedAt,
      indices: snapshot.catalogue,
    };
    await rt.store.write(rt.path.catalogue, catalogue);
  }

  console.log(`\nSnapshot ${snapshot.version}`);
  console.log(`  as of        ${snapshot.asOf}`);
  console.log(`  source       ${snapshot.source}`);
  console.log(`  catalogue    ${report.catalogueCount} indices from NSE`);
  console.log(
    `  primary      ${snapshot.indices.map((index) => index.name).join(', ')}`,
  );
  console.log(`  membership   ${JSON.stringify(report.indexCounts)}`);
  console.log(`  symbols      ${report.ok}/${report.total} with data`);
  console.log(`  stale        ${report.stale} (last bar older than ${report.asOf})`);
  console.log(`  short        ${report.short} (< 300 bars)`);
  console.log(`  coverage     ${(report.coverage * 100).toFixed(1)}%`);
  console.log(
    `  timings      catalogue ${report.timings.catalogueMs}ms · fetch ${(
      report.timings.fetchMs / 1000
    ).toFixed(1)}s · write ${report.timings.writeMs}ms`,
  );
  console.log(`  total        ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  bytes        ${(JSON.stringify(snapshot).length / 1024).toFixed(0)} KB raw`);

  if (report.warnings.length) {
    console.log('\nWarnings:');
    for (const warning of report.warnings) console.log(`  ${warning}`);
  }

  if (report.failed) {
    console.log('\nFailed symbols:');
    for (const item of report.symbols.filter((row) => row.error)) {
      console.log(`  ${item.symbol}: ${item.error}`);
    }
  }

  if (report.stale) {
    console.log('\nStale symbols:');
    for (const item of report.symbols.filter(
      (row) => row.bars > 0 && row.last !== report.asOf,
    )) {
      console.log(`  ${item.symbol}: last ${item.last} (${item.bars} bars)`);
    }
  }

  if (report.short) {
    console.log('\nShort history:');
    for (const item of report.symbols.filter(
      (row) => row.bars > 0 && row.bars < 300,
    )) {
      console.log(`  ${item.symbol}: ${item.bars} bars from ${item.first}`);
    }
  }

  if (report.coverage < 0.95 && !args.allowPartial) {
    console.error(
      `\nCoverage ${(report.coverage * 100).toFixed(1)}% is below 95%. ` +
        'Re-run with --allow-partial to keep this snapshot.',
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
