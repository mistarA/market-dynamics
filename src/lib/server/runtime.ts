import { createBlobStore, createFileStore, type JsonStore } from './store';

export type Runtime = {
  /** True when reading and writing local files instead of Blob. */
  local: boolean;
  /** False on read-only serverless runtimes without Blob configured. */
  persist: boolean;
  store: JsonStore;
  path: {
    snapshot: string;
    catalogue: string;
    scripcodes: string;
    results: string;
    eps: string;
    details: string;
    index: (slug: string, version?: string) => string;
  };
};

/**
 * Pick file storage locally and Blob on Vercel. The paths differ so the local
 * cache stays out of the deployed public directory.
 */
export function runtime(): Runtime {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const local = !token;
  const store = token ? createBlobStore(token) : createFileStore(process.cwd());
  const persist = Boolean(token) || !process.env.VERCEL;

  return {
    local,
    persist,
    store,
    path: {
      snapshot: local ? 'public/data/snapshot.json' : 'snapshots/snapshot.json',
      catalogue: local ? 'data/cache/catalogue.json' : 'state/catalogue.json',
      scripcodes: local ? 'data/cache/scripcodes.json' : 'state/scripcodes.json',
      results: local ? 'data/cache/results.json' : 'snapshots/results.json',
      eps: local ? 'data/cache/eps.json' : 'snapshots/eps.json',
      details: local ? 'data/cache/details.json' : 'snapshots/details.json',
      index: (slug: string, version?: string) => {
        const suffix = version ? `.${version}` : '';
        return local
          ? `data/cache/indexes/${slug}${suffix}.json`
          : `snapshots/indexes/${slug}${suffix}.json`;
      },
    },
  };
}
