import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    fs: { allow: [path.resolve(here, '../..')] },
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: false } },
  },
  build: { outDir: path.resolve(here, 'dist'), emptyOutDir: true },
});
