import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      react(), 
      tailwindcss(),
    ],
    build: {
      target: 'es2022',
      cssCodeSplit: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
        'react': path.resolve(process.cwd(), 'node_modules', 'react'),
        'react-dom': path.resolve(process.cwd(), 'node_modules', 'react-dom'),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
