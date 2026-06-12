import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { handleAi } from './api/_handler.js'

// Dev-only middleware that mounts the same /api/ai handler used in production,
// so `npm run dev` works without deploying. Keys are read from .env (server-side).
function aiDevServer(env) {
  return {
    name: 'ai-dev-server',
    configureServer(server) {
      server.middlewares.use('/api/ai', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        let raw = ''
        req.on('data', (chunk) => { raw += chunk })
        req.on('end', async () => {
          try {
            const body = raw ? JSON.parse(raw) : {}
            const result = await handleAi(body, env)
            res.setHeader('Content-Type', 'application/json')
            res.statusCode = 200
            res.end(JSON.stringify(result))
          } catch (e) {
            res.statusCode = e.status || 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: e.message || 'AI proxy error' }))
          }
        })
      })
    },
  }
}

// Vite's dev server serves everything under public/ with `Cache-Control: no-cache`,
// which forces the browser to re-request (revalidate) on EVERY hit. The sprite
// system swaps an <img src> ~10×/sec per character tile and PIXI loads frames per
// action, so that no-cache turns into a constant flood of frame-PNG requests in
// the Network tab — both on the setup screen and during fights. These frame assets
// never change at runtime, so make the browser actually cache them.
function staticAssetCache() {
  return {
    name: 'static-asset-cache',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/assets/')) {
          const policy = 'public, max-age=31536000'
          // Set it now so it lands on EVERY response — including sirv's 304
          // revalidation path, which otherwise sends no Cache-Control at all.
          // A bare 304 leaves the browser's old `no-cache` entry in place, so
          // it revalidates forever; carrying the policy on the 304 lets the
          // browser update the stored entry and stop re-requesting.
          res.setHeader('Cache-Control', policy)
          // sirv still tries to set `no-cache` on the 200 body path; pin our
          // value so that downstream set can't override it.
          const setHeader = res.setHeader.bind(res)
          res.setHeader = (name, value) =>
            String(name).toLowerCase() === 'cache-control'
              ? setHeader('Cache-Control', policy)
              : setHeader(name, value)
        }
        next()
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Expose all env vars (not just VITE_*) to the dev middleware.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  return {
    plugins: [react(), tailwindcss(), aiDevServer(env), staticAssetCache()],
    server: {
      allowedHosts: true,
    },
  }
})
