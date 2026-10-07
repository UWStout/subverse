import { randomBytes } from 'crypto'
import { getDatabase } from './db.js'
import { sendVerificationEmail } from './mailer.js'

/** Lifetime of email-verification tokens, measured from when they were sent. */
export const VERIFICATION_TOKEN_TTL = process.env.VERIFICATION_TIMEOUT ?? '15m'

/**
 * Generate a cryptographically random token (64 hex chars). Used for both
 * email-verification and password-reset tokens.
 */
export function generateVerificationToken () {
  return randomBytes(32).toString('hex')
}

/**
 * Convert a duration string like '15m', '8h', '30s' (or plain ms) to
 * milliseconds. Throws on values that do not match.
 */
export function parseDuration (duration) {
  const match = /^(\d+)\s*(ms|s|m|h)?$/.exec(String(duration).trim())
  if (!match) throw new Error(`Invalid duration: ${duration}`)
  const factors = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }
  return Number(match[1]) * factors[match[2] ?? 'ms']
}

/**
 * Normalize a stored send timestamp (Date from Prisma, or ISO string in tests)
 * to epoch milliseconds. Returns null when absent.
 */
export function tokenSentAtMs (value) {
  if (!value) return null
  return value instanceof Date ? value.getTime() : Date.parse(value)
}

/**
 * Best-effort delivery of a verification email. Never throws: SMTP failures
 * are logged and reported through the returned boolean so account creation
 * can proceed (the account stays provisional until a token is delivered).
 */
export async function deliverVerificationEmail (user, token) {
  try {
    await sendVerificationEmail(user, token)
    return true
  } catch (err) {
    console.error(`Failed to send verification email to ${user.email}:`, err)
    return false
  }
}

/**
 * Issue a fresh verification token for the user, replacing any pending one,
 * and record the send time. Returns the updated user and the new token.
 */
export async function reissueVerificationToken (userId) {
  const db = getDatabase()
  const token = generateVerificationToken()
  const user = await db.user.update({
    where: { id: userId },
    data: { verification_token: token, verification_sent_at: new Date() }
  })
  return { user, token }
}

/**
 * Find the account whose pending verification token matches and clear it,
 * which lifts the account's provisional status. Tokens older than
 * VERIFICATION_TOKEN_TTL (measured from verification_sent_at) are expired.
 *
 * Returns:
 *   null                    - no account holds that token (unknown or used)
 *   { user, expired: true }  - matched, but past its TTL (not cleared; the
 *                              account can request a fresh one)
 *   { user, expired: false } - verified; user is the updated record
 */
export async function verifyEmailByToken (token) {
  const db = getDatabase()
  const user = await db.user.findFirst({ where: { verification_token: token } })
  if (!user) return null

  const sentAtMs = tokenSentAtMs(user.verification_sent_at)
  if (sentAtMs !== null && Date.now() - sentAtMs > parseDuration(VERIFICATION_TOKEN_TTL)) {
    return { user, expired: true }
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: { verification_token: null, verification_sent_at: null }
  })
  return { user: updated, expired: false }
}
