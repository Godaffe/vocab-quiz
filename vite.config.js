import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/vocab-quiz/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      includeAssets: ['sql-wasm.wasm', 'sql-wasm-browser.wasm', 'icons/favicon.ico', 'icons/apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'Vocab Quiz',
        short_name: 'Vocab',
        start_url: '.',
        display: 'standalone',
        background_color: '#EDE9DC',
        theme_color: '#EDE9DC',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ]
});
