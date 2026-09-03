import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { handleAi } from './api/_handler.js'
import { handleMatchStart, handleSubmitScore, handleDeleteAccount } from './api/_scoreHandler.js'

// Dev-only middleware that mounts the same /api/moves handler used in production,
// so `npm run dev` works without deploying. Keys are read from .env (server-side).
function aiDevServer(env) {
  return {
    name: 'ai-dev-server',
    configureServer(server) {
      server.middlewares.use('/api/moves', (req, res) => {
        // Mirror the production CORS headers so the app can be tested against a
        // LAN dev server (VITE_API_BASE=http://<mac-ip>:5173) on a real device.
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
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
            const authHeader = req.headers['authorization']
            const authToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined
            const result = await handleAi(body, env, authToken)
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

// Dev-only middleware for the leaderboard write endpoints (/api/match-start,
// /api/score), mirroring aiDevServer so `npm run dev` runs the same handlers as
// production. Reads the Supabase Bearer token from the Authorization header.
function scoreDevServer(env) {
  const bearer = (h) => (typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : undefined)
  const routes = { '/api/match-start': handleMatchStart, '/api/score': handleSubmitScore, '/api/delete-account': handleDeleteAccount }
  return {
    name: 'score-dev-server',
    configureServer(server) {
      for (const [path, fn] of Object.entries(routes)) {
        server.middlewares.use(path, (req, res) => {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
          if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
          if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'Method not allowed' })); return }
          const authToken = bearer(req.headers['authorization'])
          let raw = ''
          req.on('data', (chunk) => { raw += chunk })
          req.on('end', async () => {
            try {
              const body = raw ? JSON.parse(raw) : {}
              const result = await fn({ authToken, body }, env)
              res.setHeader('Content-Type', 'application/json')
              res.statusCode = 200
              res.end(JSON.stringify(result))
            } catch (e) {
              res.statusCode = e.status || 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: e.message || 'score proxy error' }))
            }
          })
        })
      }
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
    plugins: [react(), tailwindcss(), aiDevServer(env), scoreDevServer(env), staticAssetCache()],
    server: {
      allowedHosts: true,
    },
  }
})
