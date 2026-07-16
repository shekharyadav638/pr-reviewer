import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env from project root (.env / .env.local)
  const env = loadEnv(mode, process.cwd(), '')

  const uiPort  = parseInt(env.UI_PORT  || env.VITE_PORT || '5173', 10)
  const apiBase = env.VITE_API_BASE || `http://127.0.0.1:${env.API_PORT || '8000'}`

  return {
    plugins: [react()],
    server: {
      port: uiPort,
      // Proxy API calls to the backend in dev so CORS isn't needed
      proxy: {
        '/api':     { target: apiBase, changeOrigin: true },
        '/analyze': { target: apiBase, changeOrigin: true },
        '/repos':   { target: apiBase, changeOrigin: true },
        '/health':  { target: apiBase, changeOrigin: true },
        '/webhook': { target: apiBase, changeOrigin: true },
        '/bitbucket': { target: apiBase, changeOrigin: true },
        '/feedback':  { target: apiBase, changeOrigin: true },
      },
    },
  }
})
