import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import indicesHandler from './api/indices';
import indexHandler from './api/index';
import refreshHandler from './api/refresh';

type Handler = (req: any, res: any) => void | Promise<void>;

/**
 * Run the read-only data endpoints inside the Vite dev server.
 *
 * This keeps `npm run dev` working without Vercel or Blob: `/api/index` reads
 * the locally generated snapshot and caches lazy indices under data/cache.
 */
function localApi(): Plugin {
  const routes: Record<string, Handler> = {
    '/api/indices': indicesHandler as Handler,
    '/api/index': indexHandler as Handler,
    '/api/refresh': refreshHandler as Handler,
  };

  return {
    name: 'local-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const path = url.split('?')[0];

        if (path === '/api/version') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ version: null, configured: false }));
          return;
        }

        const handler = routes[path];
        if (!handler) {
          next();
          return;
        }

        const query = Object.fromEntries(new URL(url, 'http://localhost').searchParams);
        (req as any).query = query;

        const adapter = {
          status(code: number) {
            res.statusCode = code;
            return adapter;
          },
          json(body: unknown) {
            if (!res.headersSent) {
              res.setHeader('Content-Type', 'application/json');
            }
            res.end(JSON.stringify(body));
          },
          setHeader(name: string, value: string) {
            res.setHeader(name, value);
          },
        };

        Promise.resolve(handler(req, adapter)).catch((error: unknown) => {
          console.error('local-api', error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
          }
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
});
