import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // Same-origin in dev: the API (and Better Auth cookies) are proxied.
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:8080', changeOrigin: false } },
  },
  test: { environment: 'jsdom', globals: false, setupFiles: ['./test/setup.ts'] },
});
