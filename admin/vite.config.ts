import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Routes that are both frontend pages AND backend API prefixes.
// On a browser reload, the request has Accept: text/html — serve index.html.
// On a fetch/XHR call the Accept header won't include text/html — proxy it.
function apiOnly(req: any) {
  if (req.headers['accept']?.includes('text/html')) return '/index.html'
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const BACKEND = env.VITE_BACKEND_URL || 'http://localhost:8000'

  return {
    plugins: [react()],
    server: {
      host: true,
      proxy: {
        '/auth':         { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/uploads':      { target: BACKEND, changeOrigin: true },
        '/prayer':       { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/announcements': { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/hadith':       { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/questions':    { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/donations':    { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/admin':        { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/chanda':       { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/expenses':     { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/finance':      { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/funds':        { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/upload':       { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/ws': {
          target: BACKEND,
          changeOrigin: true,
          ws: true,
          configure: (proxy) => {
            proxy.on('error', () => { /* swallow ECONNRESET during backend restarts */ })
          },
        },
        '/payments':     { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/user':         { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/users':        { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/staff':        { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/collector':    { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/reports':      { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/audit':        { target: BACKEND, changeOrigin: true, bypass: apiOnly },
        '/devices':      { target: BACKEND, changeOrigin: true, bypass: apiOnly },
      },
    },
  }
})
