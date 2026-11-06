import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development Vite serves the SPA and proxies the backend routes to the
// Fastify Local_Backend; in the packaged build Fastify serves the built assets.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8484',
      '/auth': 'http://127.0.0.1:8484',
      '/callback': 'http://127.0.0.1:8484',
    },
  },
});
