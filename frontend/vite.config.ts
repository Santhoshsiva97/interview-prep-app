import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In Docker this is http://backend:3000 (set in docker-compose.yml).
      '/api': process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000',
    },
    // File-change events don't cross Windows/macOS bind mounts into Docker.
    watch: { usePolling: process.env.VITE_USE_POLLING === 'true' },
  },
});
