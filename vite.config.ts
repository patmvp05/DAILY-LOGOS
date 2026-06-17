import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const appVersion = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig(() => {
  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['icons/logo.svg'],
        manifestFilename: 'manifest.json',
        manifest: {
          name: 'The Daily Logos',
          short_name: 'Logos',
          description: 'Clean, modern daily Bible reading plan.',
          theme_color: '#FAFAFA',
          background_color: '#FAFAFA',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            { src: '/icons/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: '/icons/logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/icons/logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ]
        },
        workbox: {
          skipWaiting: true,
          clientsClaim: true,
          // Firebase Auth's sign-in pages (/__/auth/handler, /__/auth/iframe) are
          // served by Firebase Hosting on this same origin. Without this denylist
          // the service worker answers those navigations with the cached app shell,
          // which breaks Google sign-in (auth/internal-error / silent no-op).
          // /reset.html is the cache-repair escape hatch and must always hit the
          // network, never the cached shell.
          navigateFallbackDenylist: [/^\/__\//, /^\/reset\.html/],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          globIgnores: ['**/reset.html'],
          runtimeCaching: [
            {
              // Same-origin static Bible text (public/bible/**, optional ?b=
              // cache-bust). NetworkFirst — NOT CacheFirst — because a chapter's
              // file may not exist yet (Firebase's SPA rewrite would answer a
              // missing file with index.html); going to the network first means
              // that once the real JSON is deployed it's picked up immediately,
              // while the cache still serves it offline. The app's own
              // IndexedDB cache makes repeat reads instant regardless.
              urlPattern: /\/bible\/[A-Z]+\/\d+\/\d+\.json(\?.*)?$/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'static-bible-text-v2',
                networkTimeoutSeconds: 8,
                expiration: {
                  maxEntries: 6000,
                  maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              // bible-api.com (public-domain texts + KJV fallback). Cache so a
              // re-read works offline; revalidate in the background when online.
              urlPattern: /^https:\/\/bible-api\.com\/.*/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'bible-api-cache',
                expiration: {
                  maxEntries: 500,
                  maxAgeSeconds: 60 * 60 * 24 * 365
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-stylesheets',
                expiration: {
                  maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
                }
              }
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-webfonts',
                expiration: {
                  maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            }
          ]
        }
      })
    ],
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('firebase')) {
              return 'firebase';
            }
            if (id.includes('framer-motion') || id.includes('motion/react')) {
              return 'motion';
            }
            if (id.includes('lucide-react')) {
              return 'icons';
            }
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('date-fns') ||
              id.includes('clsx') ||
              id.includes('tailwind-merge') ||
              id.includes('idb-keyval')
            ) {
              return 'vendor';
            }
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
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
