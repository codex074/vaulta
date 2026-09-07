import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-master.svg'],
      manifest: {
        name: 'NAS Files',
        short_name: 'NAS',
        description: 'Personal NAS file browser',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        background_color: '#14171c',
        theme_color: '#14171c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://192.168.1.22:30334',
        changeOrigin: true,
        cookieDomainRewrite: '',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
