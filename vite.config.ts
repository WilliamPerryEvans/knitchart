import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const forPages = !!process.env.GITHUB_PAGES

// https://vite.dev/config/
export default defineConfig({
  // GitHub project pages serve from /<repo>/, but the Tauri desktop build loads
  // dist/ off the filesystem and breaks if asset URLs are prefixed. So the base
  // path is set only by the Pages workflow, never for the desktop build.
  base: forPages ? '/knitchart/' : '/',
  plugins: [
    react(),
    VitePWA({
      // The plugin stays in the list either way so `virtual:pwa-register`
      // always resolves; disabled, it supplies a no-op. A service worker must
      // NOT ship in the desktop build — it would cache the app shell inside the
      // Tauri WebView and keep serving it after `npm run install-app`, leaving
      // the desktop app silently running an old version.
      disable: !forPages,
      // Reloading on its own would throw away the row being drawn, so the app
      // asks instead. See components/UpdatePrompt.tsx.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'KnitChart',
        short_name: 'KnitChart',
        description: 'Design colourwork knitting charts in your own gauge, on any device.',
        theme_color: '#1f2228',
        background_color: '#17191d',
        display: 'standalone',
        // Deliberately not locked to portrait: a 60-stitch chart is far easier
        // to read turned sideways, and locking it would fight the knitter.
        orientation: 'any',
        categories: ['productivity', 'graphics'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          // Android crops icons to the launcher's shape; with no maskable entry
          // it pastes the square onto a white plate instead.
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        cleanupOutdatedCaches: true,
        // One route, so every navigation resolves to the app shell.
        navigateFallback: 'index.html',
      },
    }),
  ],
})
