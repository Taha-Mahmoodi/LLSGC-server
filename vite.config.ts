import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: 'client',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:47291',
      '/ws': {
        target: 'ws://localhost:47291',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    sourcemap: false,
  },
});
