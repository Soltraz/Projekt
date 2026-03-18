// docx-editor/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,            // optional
    strictPort: false,     // optional
    proxy: {
      // Alle Aufrufe an /api -> http://localhost:3000
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        // Wenn dein Backend KEIN /api-Prefix erwartet, aktiviere die Zeile darunter:
        // rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
