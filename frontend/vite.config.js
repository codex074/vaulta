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
        name: 'Vaulta',
        short_name: 'Vaulta',
        description: 'Private file storage for the home network',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        background_color: '#090d12',
        theme_color: '#090d12',
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
        target: process.env.VITE_API_TARGET || 'http://192.168.1.22:30334',
        changeOrigin: true,
        cookieDomainRewrite: '',
      },
      '/nasapi': {
        target: process.env.VITE_NASAPI_TARGET || 'http://192.168.1.22:8090',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
