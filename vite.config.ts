import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createApi } from './server/api.ts';
import { DATA_DIR } from './server/config.ts';

/**
 * The HarpForge server's API in the dev server and Vite's preview too (the same data folder).
 * The data folder itself is never handed out as files (Vite serves the project's files):
 * accounts and songs only through the API, signed in.
 */
function harpforgeApi(): Plugin {
  const api = createApi({ dataDir: DATA_DIR });
  const use = (server: { middlewares: Connect.Server }) => {
    server.middlewares.use((req, res, next) => {
      let path = '';
      try {
        path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/\\/g, '/').toLowerCase();
      } catch {
        path = '';
      }
      if (/^\/+data(\/|$)/.test(path)) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      api(req, res).then(
        (handled) => handled || next(),
        () => next(),
      );
    });
  };
  return { name: 'harpforge-api', configureServer: use, configurePreviewServer: use };
}

export default defineConfig({
  plugins: [react(), harpforgeApi()],
  server: {
    // (Accounts and songs: not files Vite may hand out by any path, nor watch.)
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**'] },
    watch: { ignored: ['**/data/**'] },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
} as any);
