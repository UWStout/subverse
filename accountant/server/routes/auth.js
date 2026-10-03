/* eslint-disable camelcase */
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Router, json } from 'express'
import { getDatabase } from '../db.js'

// Lazily resolve the database client on first request (avoids ESM init-order issues)
let db
function getDb () {
  if (!db) db = getDatabase()
  return db
}

const authRouter = new Router()

authRouter.use(json())

/**
 * Signing secret for session tokens. Set JWT_SECRET in the environment for
 * anything beyond local development.
 */
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-do-not-use-in-production'
const TOKEN_TTL = '8h'

/** Strip sensitive fields from a user object before returning it. */
function sanitizeUser (user) {
  const { password_hash, verification_token, reset_token, ...safe } = user
  return safe
}

/**
 * Express middleware: require a valid `Authorization: Bearer <token>` header.
 * Attaches the decoded token payload to req.user on success; responds 401
 * when the header is missing, malformed, or the token is invalid/expired.
 */
export function authenticate (req, res, next) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' })
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// POST /auth/login — exchange credentials for a session token
authRouter.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }

    const user = await getDb().user.findUnique({ where: { username } })
    // Same response for unknown user and wrong password (don't leak which one failed)
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
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

// GET /auth/me — return the user identified by the bearer token
authRouter.get('/me', authenticate, async (req, res) => {
  try {
    const user = await getDb().user.findUnique({ where: { id: req.user.sub } })
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists' })
    }
    res.json(sanitizeUser(user))
  } catch (err) {
    console.error('Error fetching current user:', err)
    res.status(500).json({ error: 'Failed to fetch current user' })
  }
})

export default authRouter
