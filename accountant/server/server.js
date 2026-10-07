import 'dotenv/config'

import path from 'path'
import { fileURLToPath } from 'url'
import { APP_NAME } from './config.js'
import { initDatabase } from './db.js'
import { maybeStartBootstrap } from './bootstrap.js'
import { accessLog } from './middleware/logger.js'

import express from 'express'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

// Initialize SQLite database before any routes are imported
initDatabase()

// First-startup bootstrap: if no accounts exist yet, mint a one-time signed
// token and print it to the logs so the initial ADMIN can be created from
// the login page (see server/bootstrap.js).
await maybeStartBootstrap()

// Import route modules (they depend on the initialized database)
import authRouter from './routes/auth.js'
import userRouter from './routes/user.js'
import classRouter from './routes/class.js'
import offeringRouter from './routes/offering.js'
import projectRouter from './routes/project.js'

// Setup the express app
const app = express()
const port = process.env.PORT || 3000

// Access log - one line per request (method, path, status, duration, ip).
// Mounted before the routes so every response, including errors, is logged.
app.use(accessLog)

// --- API Routes ---
app.use('/auth/', authRouter)
app.use('/user/', userRouter)
app.use('/class/', classRouter)
app.use('/offering/', offeringRouter)
app.use('/project/', projectRouter)

// --- Static File Server ---
// Serve static files from the public directory (compiled frontend + static assets)
app.use(express.static(path.join(ROOT_DIR, 'public')))

// --- SPA Fallback ---
// Client-side routes (e.g. /users, /offerings) are not real files on disk.
// When a browser loads or refreshes one directly, serve index.html so React
// Router can render the matching page. API prefixes are excluded so unknown
// API paths still produce a proper 404 instead of an HTML page.
const API_PREFIXES = ['auth', 'user', 'class', 'offering', 'project']
app.use((req, res, next) => {
  if (req.method !== 'GET' || !req.accepts('html')) return next()
  const segment = req.path.split('/')[1]
  if (API_PREFIXES.includes(segment)) return next()
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'))
})

// --- Error Handler ---
// Catches anything that slips past a route handler's own try/catch
// (e.g. malformed JSON bodies rejected by express.json()). Logs the full
// error; returns a JSON body instead of Express's default HTML page.
app.use((err, req, res, next) => {
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err)
  if (res.headersSent) {
    return next(err)
  }
  const status = Number.isInteger(err.status) ? err.status : 500
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : (err.message || 'Bad request') })
})

// --- Start the Server ---
app.listen(port, () => {
  console.log(`${APP_NAME} server running on port ${port}`)
})
