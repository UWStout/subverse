import { getDatabase } from './db.js'
import { sendPasswordResetEmail, sendSetPasswordEmail } from './mailer.js'
import { generateVerificationToken, parseDuration, tokenSentAtMs } from './verification.js'

/** Lifetime of password-reset tokens, measured from when they were sent. */
export const RESET_TOKEN_TTL = process.env.RESET_TIMEOUT ?? '15m'

/**
 * Find an account by username or email and issue it a fresh reset token
 * (replacing any pending one), recording the send time.
 * Returns { user, token } when an account matches, or null otherwise.
 */
export async function requestPasswordReset (identifier) {
  const db = getDatabase()
  const user = await db.user.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier }] }
  })
  if (!user) return null

  const token = generateVerificationToken()
  await db.user.update({
    where: { id: user.id },
    data: { reset_token: token, reset_sent_at: new Date() }
  })
  return { user, token }
}

/**
 * Best-effort delivery of a password-reset email. Never throws: SMTP failures
 * are logged and reported through the returned boolean.
 */
export async function deliverPasswordResetEmail (user, token) {
  try {
    await sendPasswordResetEmail(user, token)
    return true
  } catch (err) {
    console.error(`Failed to send password reset email to ${user.email}:`, err)
    return false
  }
}

/**
 * Best-effort delivery of a "set your password" email for a newly created
 * account (bulk creation, issue #3). Never throws: SMTP failures are logged
 * and reported through the returned boolean. The reset token stays in the
 * database either way, so the account can recover via forgot-password.
 */
export async function deliverSetPasswordEmail (user, token) {
  try {
    await sendSetPasswordEmail(user, token)
    return true
  } catch (err) {
    console.error(`Failed to send set-password email to ${user.email}:`, err)
    return false
  }
}

/**
 * Consume a reset token: set the account's password and clear the token.
 * The caller supplies an already-hashed password.
 *
 * Returns:
 *   null                    - no account holds that token (unknown or used)
 *   { expired: true }        - matched, but past its TTL (not consumed; a new
 *                              request can be made)
 *   { user }                 - reset complete; user is the updated record
 */
export async function resetPasswordByToken (token, passwordHash) {
  const db = getDatabase()
  const user = await db.user.findFirst({ where: { reset_token: token } })
  if (!user) return null

  const sentAtMs = tokenSentAtMs(user.reset_sent_at)
  if (sentAtMs !== null && Date.now() - sentAtMs > parseDuration(RESET_TOKEN_TTL)) {
    return { expired: true }
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: { password_hash: passwordHash, reset_token: null, reset_sent_at: null }
  })
  return { user: updated }
}
