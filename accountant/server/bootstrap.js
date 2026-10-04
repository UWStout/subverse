import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import { getDatabase } from './db.js'
import { JWT_SECRET } from './middleware/auth.js'

/** Lifetime of bootstrap tokens. Short-lived on purpose (single-use). */
export const BOOTSTRAP_TOKEN_TTL = process.env.BOOTSTRAP_TIMEOUT ?? '5m'

/**
 * Generate a signed one-time bootstrap token.
 *
 * The token is signed with the internal JWT secret and carries no user
 * identity - only a `purpose` marker and a unique id. It is returned to the
 * caller so it can be printed to the server logs; it is never persisted.
 */
export function generateBootstrapToken () {
  return jwt.sign(
    { purpose: 'bootstrap', jti: randomUUID() },
    JWT_SECRET,
    { expiresIn: BOOTSTRAP_TOKEN_TTL }
  )
}

/**
 * Verify a bootstrap token.
 * Resolves to the decoded payload when the signature is valid, the token has
 * not expired, and it was issued for bootstrapping. Throws otherwise
 * (jsonwebtoken errors such as TokenExpiredError propagate unchanged).
 */
export function verifyBootstrapToken (token) {
  const payload = jwt.verify(token, JWT_SECRET)
  if (!payload || payload.purpose !== 'bootstrap') {
    throw new Error('Not a bootstrap token')
  }
  return payload
}

/**
 * Startup check: when the users table is empty, mint a bootstrap token and
 * print it to the server logs so an operator can create the initial ADMIN
 * account from the login page. The token lives only in these logs.
 *
 * Returns true when a token was issued, false otherwise.
 */
export async function maybeStartBootstrap () {
  try {
    const count = await getDatabase().user.count()
    if (count > 0) return false

    const token = generateBootstrapToken()
    console.log('')
    console.log('============================================================')
    console.log(' BOOTSTRAP MODE: no user accounts exist yet.')
    console.log(' Open the login page and create the initial ADMIN account.')
    console.log(` One-time bootstrap token (expires in ${BOOTSTRAP_TOKEN_TTL}):`)
    console.log(`   ${token}`)
    console.log(' The token is stored nowhere except these logs.')
    console.log('============================================================')
    return true
  } catch (err) {
    console.error('Bootstrap check failed:', err)
    return false
  }
}
