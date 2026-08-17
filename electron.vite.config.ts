import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const projectRoot = __dirname;

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      commonjsOptions: { include: [/lib[\\/]node/, /node_modules/] },
      rollupOptions: { input: resolve(projectRoot, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(projectRoot, 'src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(projectRoot, 'src/renderer'),
    plugins: [react()],
    server: { fs: { allow: [projectRoot] } },
    build: {
      rollupOptions: { input: resolve(projectRoot, 'src/renderer/index.html') },
    },
  },
});
