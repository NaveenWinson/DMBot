import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: { proxy: { '/server': { target: 'http://localhost:9000', changeOrigin: true } } },
  build: { outDir: 'dist' },
});
