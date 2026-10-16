import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createApi } from './server/api.ts';
import { DATA_DIR } from './server/config.ts';

/** The HarpForge server's API in the dev server and Vite's preview too (the same data folder). */
function harpforgeApi(): Plugin {
  const api = createApi({ dataDir: DATA_DIR });
  const use = (server: { middlewares: Connect.Server }) => {
    server.middlewares.use((req, res, next) => {
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
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
} as any);
