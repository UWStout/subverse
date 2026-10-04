/* eslint-disable camelcase */
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Router, json } from 'express'
import { getDatabase } from '../db.js'
import { authenticate, JWT_SECRET, TOKEN_TTL } from '../middleware/auth.js'
import { verifyBootstrapToken } from '../bootstrap.js'

// Lazily resolve the database client on first request (avoids ESM init-order issues)
let db
function getDb () {
  if (!db) db = getDatabase()
  return db
}

const authRouter = new Router()

authRouter.use(json())

/** Strip sensitive fields from a user object before returning it. */
function sanitizeUser (user) {
  const { password_hash, verification_token, reset_token, ...safe } = user
  return safe
}

// POST /auth/login - exchange credentials for a session token (public)
authRouter.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }

    const user = await getDb().user.findUnique({ where: { username } })
    // Same response for unknown user and wrong password (don't leak which one failed)
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      console.error(`Login failed from ${req.ip}: ${user ? `invalid password for '${username}'` : `unknown user '${username}'`}`)
      return res.status(401).json({ error: 'Invalid username or password' })
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, type: user.type },
      JWT_SECRET,
      { expiresIn: TOKEN_TTL }
    )

    res.json({ token, user: sanitizeUser(user) })
  } catch (err) {
    console.error('Error logging in:', err)
    res.status(500).json({ error: 'Login failed' })
  }
})

// GET /auth/bootstrap/status - public; tells the client whether the initial
// admin account still needs to be created (users table is empty).
authRouter.get('/bootstrap/status', async (req, res) => {
  try {
    const count = await getDb().user.count()
    res.json({ bootstrap: count === 0 })
  } catch (err) {
    console.error('Error checking bootstrap status:', err)
    res.status(500).json({ error: 'Failed to check bootstrap status' })
  }
})

// POST /auth/bootstrap - public, single-use; create the initial ADMIN account.
// Requires the one-time signed token printed in the server logs at startup.
authRouter.post('/bootstrap', async (req, res) => {
  try {
    const { token, username, email, password, first_name, last_name } = req.body

    if (!token || !username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields: token, username, email, password' })
    }

    // Bootstrap is single-use: once any account exists it is permanently closed.
    const count = await getDb().user.count()
    if (count > 0) {
      return res.status(410).json({ error: 'Bootstrap already completed - an account already exists' })
    }

    // Verify the signed one-time token (bad signature, wrong purpose, or expired)
    try {
      verifyBootstrapToken(token)
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(400).json({ error: 'Bootstrap token has expired. Restart the server to issue a new one.' })
      }
      console.error(`Bootstrap rejected from ${req.ip}: invalid bootstrap token (${err.message})`)
      return res.status(401).json({ error: 'Invalid bootstrap token' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await getDb().user.create({
      data: {
        username,
        email,
        password_hash: passwordHash,
        type: 'ADMIN',
        first_name: first_name ?? null,
        last_name: last_name ?? null
      }
    })

    console.log(`Bootstrap complete: initial ADMIN account '${username}' created`)
    res.status(201).json({ message: 'Initial admin account created', user: sanitizeUser(user) })
  } catch (err) {
    console.error('Error creating bootstrap account:', err)
    res.status(500).json({ error: 'Failed to create initial account' })
  }
})

// All remaining auth routes require a valid session token
authRouter.use(authenticate)

// GET /auth/me - return the user identified by the bearer token
authRouter.get('/me', async (req, res) => {
  try {
    const user = await getDb().user.findUnique({ where: { id: req.user.sub } })
    if (!user) {
      console.error(`AUTH FAIL: GET /auth/me from ${req.ip} - token user id ${req.user.sub} no longer exists`)
      return res.status(401).json({ error: 'User no longer exists' })
    }
    res.json(sanitizeUser(user))
  } catch (err) {
    console.error('Error fetching current user:', err)
    res.status(500).json({ error: 'Failed to fetch current user' })
  }
})

export default authRouter
