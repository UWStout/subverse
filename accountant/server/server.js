import 'dotenv/config'

import path from 'path'
import { fileURLToPath } from 'url'
import { initDatabase } from './db.js'

import express from 'express'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

// Initialize SQLite database before any routes are imported
initDatabase()

// Import route modules (they depend on the initialized database)
import authRouter from './routes/auth.js'
import userRouter from './routes/user.js'
import classRouter from './routes/class.js'
import offeringRouter from './routes/offering.js'
import projectRouter from './routes/project.js'

// Setup the express app
const app = express()
const port = process.env.PORT || 3000

// --- API Routes ---
app.use('/auth/', authRouter)
app.use('/user/', userRouter)
app.use('/class/', classRouter)
app.use('/offering/', offeringRouter)
app.use('/project/', projectRouter)

// --- Static File Server ---
// Serve static files from the public directory (compiled frontend + static assets)
app.use(express.static(path.join(ROOT_DIR, 'public')))

// --- Start the Server ---
app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
