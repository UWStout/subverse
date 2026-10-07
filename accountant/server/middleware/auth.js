import 'dotenv/config'
import jwt from 'jsonwebtoken'
import { getDatabase } from '../db.js'

/**
 * Signing secret for session tokens. Set JWT_SECRET in the environment for
 * anything beyond local development.
 */
export const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-only-secret-do-not-use-in-production'

/** Lifetime of issued session tokens. */
export const TOKEN_TTL = process.env.JWT_TIMEOUT ?? '8h'

/**
 * Express middleware: require a valid `Authorization: Bearer <token>` header.
 * Attaches the decoded token payload to req.user on success; responds 401
 * when the header is missing, malformed, or the token is invalid/expired.
 */
export function authenticate (req, res, next) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) {
    console.error(`AUTH FAIL: ${req.method} ${req.originalUrl} from ${req.ip} - missing or malformed Authorization header`)
    return res.status(401).json({ error: 'Missing or malformed Authorization header' })
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch (err) {
    console.error(`AUTH FAIL: ${req.method} ${req.originalUrl} from ${req.ip} - invalid or expired token (${err.message})`)
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

/**
 * Express middleware: require the session user's email address to be verified.
 * Must run after authenticate(). Any account with a pending verification_token
 * is PROVISIONAL and receives 403 on every protected route until it verifies
 * its email (see POST /auth/verify-email). The status is read from the database
 * on each request, so verification takes effect immediately - no re-login needed.
 */
export async function requireVerified (req, res, next) {
  try {
    const user = await getDatabase().user.findUnique({ where: { id: req.user.sub } })
    // Unknown or deleted users fall through; the route handles them (401/404).
    if (!user) return next()

    if (user.verification_token != null) {
      console.error(`AUTH FAIL: ${req.method} ${req.originalUrl} from ${req.ip} - user '${user.username}' has an unverified email address`)
      return res.status(403).json({ error: 'Email address not verified', email_verified: false })
    }

    next()
  } catch (err) {
    console.error('Error checking email verification status:', err)
    res.status(500).json({ error: 'Failed to check account status' })
  }
}
