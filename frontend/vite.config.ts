import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // ASP.NET auth API (CORS-blocked in dev) — relayed by Vite so the
      // browser sees the request as same-origin.
      //
      // /auth-api/login → http://hti-dtswebsrv:2020/api/Auth/login
      '/auth-api': {
        target: 'http://hti-dtswebsrv:2020',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/auth-api/, '/api/Auth'),

        // Make the auth cookie returned by the backend usable from localhost:5173.
        // Without this, the Set-Cookie header has Domain=hti-dtswebsrv and the
        // browser silently drops it → the next request is anonymous.
        cookieDomainRewrite: { '*': '' },
        cookiePathRewrite:   { '/api/Auth': '/auth-api', '/': '/' },

        // Verbose logging so you can see exactly what the upstream server returns.
        configure: (proxy, _options) => {
          proxy.on('error', (err, req, _res) => {
            console.error('[auth-proxy] error:', err.message, '·', req.method, req.url)
          })
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log(`[auth-proxy] → ${req.method} ${proxyReq.path}`)
          })
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log(`[auth-proxy] ← ${proxyRes.statusCode} ${req.method} ${req.url}`)
            // Dump the response body when the upstream errors (helps diagnose 500s)
            const status = proxyRes.statusCode || 0
            if (status >= 400) {
              const chunks: Buffer[] = []
              proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
              proxyRes.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8').slice(0, 600)
                if (body) console.error('[auth-proxy] upstream error body:', body)
              })
            }
          })
        },
      },
    },
  },
})
