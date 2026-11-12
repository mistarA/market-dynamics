import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { head, put } from '@vercel/blob';

/**
 * Minimal JSON storage used by the server-side data plumbing.
 *
 * Local development writes under the project directory; Vercel uses Blob when
 * BLOB_READ_WRITE_TOKEN is configured.
 */
export type JsonStore = {
  read<T>(path: string): Promise<T | null>;
  write(path: string, value: unknown): Promise<void>;
  /** Public URL when the store is CDN-backed; null for local files. */
  url(path: string): Promise<string | null>;
};

export function createFileStore(root = process.cwd()): JsonStore {
  return {
    async read<T>(path: string): Promise<T | null> {
      try {
        const text = await readFile(resolve(root, path), 'utf8');
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    },
    async write(path: string, value: unknown): Promise<void> {
      const full = resolve(root, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, `${JSON.stringify(value)}\n`, 'utf8');
    },
    async url(): Promise<string | null> {
      return null;
    },
  };
}

export function createBlobStore(token?: string): JsonStore {
  const options = token ? { token } : undefined;
  return {
    async read<T>(path: string): Promise<T | null> {
      try {
        const blob = await head(path, options);
        const response = await fetch(blob.url, { cache: 'no-store' });
        if (!response.ok) return null;
        return (await response.json()) as T;
      } catch {
        return null;
      }
    },
    async write(path: string, value: unknown): Promise<void> {
      await put(path, JSON.stringify(value), {
        ...options,
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        cacheControlMaxAge: 0,
      });
    },
    async url(path: string): Promise<string | null> {
      try {
        const blob = await head(path, options);
        return blob.url;
      } catch {
        return null;
      }
    },
  };
}
