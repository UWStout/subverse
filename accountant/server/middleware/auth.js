import 'dotenv/config'
import jwt from 'jsonwebtoken'

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
