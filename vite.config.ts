import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // HLS playlists returned by the API reference child segments at /proxy.
      '/proxy': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
});
