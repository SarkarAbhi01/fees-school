import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Dev: Vite on :5173 proxies /api to Express on :4000.
// Prod: `npm run build` writes client/dist and Express serves it on one port.
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } } },
  build: { outDir: 'dist', emptyOutDir: true },
});
