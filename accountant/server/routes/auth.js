/* eslint-disable camelcase */
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Router, json } from 'express'
import { getDatabase } from '../db.js'
import { authenticate, requireVerified, JWT_SECRET, TOKEN_TTL } from '../middleware/auth.js'
import { verifyBootstrapToken } from '../bootstrap.js'
import { generateVerificationToken, deliverVerificationEmail, verifyEmailByToken, reissueVerificationToken } from '../verification.js'
import { requestPasswordReset, deliverPasswordResetEmail, resetPasswordByToken } from '../password-reset.js'
import { setUserPassword, bestEffortSvn } from '../subversion.js'

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
    // New accounts are provisional until their email is verified: mint a token
    // and record the send time in the same write.
    const verificationToken = generateVerificationToken()
    const user = await getDb().user.create({
      data: {
        username,
        email,
        password_hash: passwordHash,
        type: 'ADMIN',
        first_name: first_name ?? null,
        last_name: last_name ?? null,
        verification_token: verificationToken,
        verification_sent_at: new Date()
      }
    })

    // Best-effort: the account stays provisional (locked out) if delivery fails.
    await deliverVerificationEmail(user, verificationToken)

    // Sync the new credentials into the SVN passwd file (same bcrypt hash as
    // the database row written above).
    await bestEffortSvn(`bootstrap user '${username}'`, () => setUserPassword(username, passwordHash))

    console.log(`Bootstrap complete: initial ADMIN account '${username}' created`)
    res.status(201).json({ message: 'Initial admin account created', user: sanitizeUser(user) })
  } catch (err) {
    console.error('Error creating bootstrap account:', err)
    res.status(500).json({ error: 'Failed to create initial account' })
  }
})

// POST /auth/verify-email - public; confirm an account's email address using
// the token emailed when the account was created. A matching token is cleared,
// which lifts the account's provisional status immediately.
authRouter.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body || {}
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Missing required field: token' })
    }

    const result = await verifyEmailByToken(token)
    if (!result) {
      console.error(`AUTH FAIL: POST /auth/verify-email from ${req.ip} - unknown verification token`)
      return res.status(400).json({ error: 'Invalid verification token' })
    }
    if (result.expired) {
      return res.status(410).json({ error: 'Verification token has expired. Request a new one.' })
    }

    console.log(`Email verified for user '${result.user.username}' (${result.user.email})`)
    res.json({ message: 'Email address verified successfully' })
  } catch (err) {
    console.error('Error verifying email:', err)
    res.status(500).json({ error: 'Failed to verify email address' })
  }
})

// POST /auth/forgot-password - public; request a password reset link.
// Accepts either a username or an email address in `identifier`. Always
// responds identically whether or not the account exists (don't leak which
// usernames/emails are registered); delivery failures are logged only.
authRouter.post('/forgot-password', async (req, res) => {
  try {
    const { identifier } = req.body || {}
    if (!identifier || typeof identifier !== 'string') {
      return res.status(400).json({ error: 'Missing required field: identifier' })
    }

    const result = await requestPasswordReset(identifier)
    if (result) {
      // Best-effort: the token stays in the DB even if delivery fails, so a
      // later retry of this route simply reissues it.
      await deliverPasswordResetEmail(result.user, result.token)
      console.log(`Password reset link sent for user '${result.user.username}' (${result.user.email})`)
    }

    res.json({ message: 'If an account matches that username or email, a password reset link has been sent' })
  } catch (err) {
    console.error('Error processing password reset request:', err)
    res.status(500).json({ error: 'Failed to process password reset request' })
  }
})

// POST /auth/reset-password - public; set a new password using the token from
// the reset email. The old password is not required; the token is single-use.
authRouter.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {}
    if (!token || typeof token !== 'string' || !password) {
      return res.status(400).json({ error: 'Missing required fields: token, password' })
    }

    // Hash before the lookup so timing does not reveal whether a token exists
    const passwordHash = await bcrypt.hash(password, 10)
    const result = await resetPasswordByToken(token, passwordHash)

    if (!result) {
      console.error(`AUTH FAIL: POST /auth/reset-password from ${req.ip} - unknown reset token`)
      return res.status(400).json({ error: 'Invalid reset token' })
    }
    if (result.expired) {
      return res.status(410).json({ error: 'Reset token has expired. Request a new one.' })
    }

    console.log(`Password reset for user '${result.user.username}' (${result.user.email})`)

    // The new hash must replace the old entry in the SVN passwd file (or be
    // created, e.g. for a bulk-created account setting its first password).
    await bestEffortSvn(`reset password for '${result.user.username}'`, () => setUserPassword(result.user.username, passwordHash))

    res.json({ message: 'Password has been reset successfully' })
  } catch (err) {
    console.error('Error resetting password:', err)
    res.status(500).json({ error: 'Failed to reset password' })
  }
})

// All remaining auth routes require a valid session token
authRouter.use(authenticate)

// POST /auth/resend-verification - authenticated; a provisional user can
// request a fresh verification link for their own account. Registered before
// requireVerified so unverified sessions may still use it.
authRouter.post('/resend-verification', async (req, res) => {
  try {
    const user = await getDb().user.findUnique({ where: { id: req.user.sub } })
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists' })
    }
    if (user.verification_token == null) {
      return res.status(400).json({ error: 'Email address already verified' })
    }

    const { user: updated, token } = await reissueVerificationToken(user.id)
    const sent = await deliverVerificationEmail(updated, token)
    if (!sent) {
      // The token was still reissued (and its expiry refreshed); the client
      // can simply retry.
      return res.status(502).json({ error: 'Failed to send verification email. Try again later.' })
    }

    console.log(`Verification email re-sent for user '${user.username}' (${user.email})`)
    res.json({ message: 'Verification email sent' })
  } catch (err) {
    console.error('Error resending verification email:', err)
    res.status(500).json({ error: 'Failed to resend verification email' })
  }
})

// ...and a verified (non-provisional) email address
authRouter.use(requireVerified)

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
