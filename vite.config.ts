import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const target = env.VITE_NYA_API_TARGET || 'http://localhost:5270'

  return {
    // Resolve production assets against the document <base>. The runtime
    // Nginx configuration rewrites that base for trusted reverse-proxy
    // prefixes while direct access keeps using `/`.
    base: './',
    plugins: [react()],
    server: {
      proxy: {
        '/alive': {
          target,
          changeOrigin: true,
        },
        '/api': {
          target,
          changeOrigin: true,
        },
      },
    },
  }
})
