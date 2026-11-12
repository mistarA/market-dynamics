# Enhancement backlog

Only pull these when the matching budget is missed. The README records the
observed runs that justify each decision.

## Snapshot transfer is over budget (measured: 1.40 MB gzip vs 1 MB target)

The core snapshot now covers the first four catalogue indices (110 symbols).
Index 5+ are lazy `/api/index` datasets, so they do not add to this payload.

1. **Drop `volume` from the snapshot.** The UI does not use it. On the older
   105-symbol build this took 1.34 MB → **0.98 MB gzip**. Cheapest possible fix
   if we decide volume is not needed for a future bhavcopy reconciliation.
2. **Columnar encoding.** Store one date axis plus parallel numeric arrays per
   symbol. Removes repeated date strings and keys before gzip.
3. **Pre-aggregate weekly and monthly bars server-side.** One year of daily plus
   three years of weekly/monthly. Also removes client aggregation work.
4. **Split the snapshot by symbol.** Lazy indices already reuse core bars, but a
   per-symbol shard store would also let a new primary index skip refetching
   overlap.
5. **Immutable versioned URLs + long CDN cache.** `?v=<version>` or
   `snapshot-<version>.json`, keeping IndexedDB as stale-while-revalidate.
6. Service worker for repeat visits.

## Lazy index load > 3 s

1. The first selection of an index fetches only symbols missing from the core
   snapshot. Cache the dataset in Blob (`snapshots/indexes/<slug>.json`) and
   IndexedDB; later selections are near-instant.
2. If the deployment region is slow to reach NSE, move dataset building to a
   GitHub Action or pre-warm the most popular indices after refresh.
3. Show the cached dataset immediately, then refresh in the background (already
   implemented).

## Cold first table > 3 s

1. Do (3) and (5) above first.
2. Render the cached table before the network check (already implemented) and
   keep the worker warm across snapshot updates where the version is unchanged.
3. Show partial rows as they arrive if sharding is introduced.
4. Trim the 6-month sparkline input to exactly the displayed points (already
   limited to 40/26/12).

## Worker compute > 200 ms

1. Compute only the selected index (already the case).
2. Typed arrays and a single pass per timeframe.
3. Precompute pivot and MSS summaries at build time for both confirmation modes
   and ship them in the snapshot.
4. Memoize per-symbol daily→weekly/monthly aggregation in the worker (currently
   re-aggregated on every timeframe switch, though it is only ~10 ms for 50
   symbols).

## `/api/version` warm > 300 ms

1. Move the function to the Edge runtime.
2. Keep it free of imports from the snapshot builder.
3. Consider storing the version inside the Blob pathname and serving it from the
   CDN, removing the function round trip entirely.

## Full refresh > 15 s

1. Use bhavcopy for the daily increment (one file for all symbols) and the
   charting API only for the initial build and weekly reconciliation.
2. Raise concurrency from 8 to 12; stagger requests by index.
3. Move the full build to a GitHub Action and keep the function for checks.
4. Use Vercel Pro/Fluid compute or an India-hosted worker if NSE blocks
   datacenter IPs.

## NSE rate-limits or blocks

1. Keep the scripcode cache; do not re-resolve on every run.
2. Increase backoff and reduce concurrency.
3. Switch the affected run to bhavcopy.
4. Fall back to a GitHub Action build uploaded to Blob.

## Deferred features

- Bhavcopy incremental ingestion (requested explicitly before starting).
- Intraday timeframes.
- Historical index membership / survivorship-bias correction.
- Configurable swing lookback (`k`) and MSS rules in the UI.
- Watchlists and alerts when a new shift appears.
- Index-level breadth (advance/decline of fresh shifts) and a benchmark chart.
- CSV/JSON export of the ranked table.

## Measurement debt

- Cold first load over a real CDN connection (currently only local dev).
- `/api/version` and `/api/refresh` timings from the deployed Vercel region.
- Serverless NSE reachability and latency from the deployment region.
- Snapshot size after each schema change.
- A repeatable Lighthouse run on the deployed build.
