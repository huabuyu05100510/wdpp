import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置:代理 /api 到现有 server.js
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
