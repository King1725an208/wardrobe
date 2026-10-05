import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '电子衣柜',
        short_name: '衣柜',
        description: '拍照管理你的衣服，记录每日穿搭',
        theme_color: '#7a9a7e',
        background_color: '#f4f6f0',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // 本地抠图模型的 wasm 较大，放宽预缓存上限
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
      },
    }),
  ],
})
