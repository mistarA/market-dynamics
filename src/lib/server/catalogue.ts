import { fetchCatalogue } from '../sources/indices';
import type { IndexInfo } from '../types';
import type { Runtime } from './runtime';

export type CatalogueCache = {
  generatedAt: string;
  indices: IndexInfo[];
};

/**
 * Read the cached catalogue, refreshing it from NSE when missing.
 * The catalogue changes rarely, so a single cached copy is enough.
 */
export async function loadCatalogue(
  rt: Runtime,
  options: { refresh?: boolean } = {},
): Promise<IndexInfo[]> {
  if (!options.refresh) {
    const cached = await rt.store.read<CatalogueCache>(rt.path.catalogue);
    if (cached?.indices?.length) return cached.indices;
  }

  const indices = await fetchCatalogue();
  if (rt.persist) {
    const cache: CatalogueCache = {
      generatedAt: new Date().toISOString(),
      indices,
    };
    await rt.store.write(rt.path.catalogue, cache);
  }
  return indices;
}
