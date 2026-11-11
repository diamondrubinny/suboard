import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served under a folder? Build with VITE_BASE_PATH=/test/ (must match PUBLIC_URL on the server).
const base = process.env.VITE_BASE_PATH ? `/${process.env.VITE_BASE_PATH.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/') : '/';

export default defineConfig({
  base,
  plugins: [react()],
  // Guarantee a single React copy across workspace packages.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    strictPort: true,
    // The API runs separately in development; the proxy keeps everything same-origin.
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  build: {
    sourcemap: false,
    target: 'es2022',
  },
});
