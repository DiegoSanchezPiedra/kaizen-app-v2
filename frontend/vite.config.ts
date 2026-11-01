import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// La API va bajo /api quitando el prefijo, igual que Nginx en producción (ADR 0013).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // ADR 0015: sw.ts propio (push) y la versión nueva con aviso, nunca autoUpdate. El registro lo hace UpdateToast.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      includeManifestIcons: false, // ya entran por globPatterns
      injectManifest: { globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'] },
      manifest: {
        name: 'Kaizen',
        short_name: 'Kaizen',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#050A2E',
        theme_color: '#050A2E',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/monochrome.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'monochrome' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})
