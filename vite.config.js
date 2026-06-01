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

export default defineConfig(({ mode }) => {
  // Expose all env vars (not just VITE_*) to the dev middleware.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  return {
    plugins: [react(), tailwindcss(), aiDevServer(env)],
    server: {
      allowedHosts: true,
    },
  }
})
