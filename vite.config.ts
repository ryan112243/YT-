import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// PWA 先暫時停用以避免 GitHub Pages 首次部署快取與路徑問題

// https://vite.dev/config/
export default defineConfig({
  base: '/YT-/',
  plugins: [
    react(),
  ],
})
