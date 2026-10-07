import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { mockPrisma, mockMailer, TEST_USER, TEST_JWT_SECRET } from './setup.js'
import path from 'path'

// ---------------------------------------------------------------------------
// Dynamic imports to get fresh routers per test (clears ESM cache + lazy getDb)
// ---------------------------------------------------------------------------
async function getAuthRouter () {
  vi.resetModules()
  const routePath = path.resolve(__dirname, '..', 'routes', 'auth.js')
  const mod = await import(routePath)
  return mod.default
}

async function getUserRouter () {
  vi.resetModules()
  const routePath = path.resolve(__dirname, '..', 'routes', 'user.js')
  const mod = await import(routePath)
  return mod.default
}

function makeToken (overrides = {}) {
  return jwt.sign(
    { sub: TEST_USER.id, username: 'testuser', type: 'STUDENT', ...overrides },
    TEST_JWT_SECRET,
    { expiresIn: '8h' }
  )
}

/** A valid bootstrap token signed with the pinned test secret. */
function makeBootstrapToken () {
  return jwt.sign({ purpose: 'bootstrap', jti: 'test-jti' }, TEST_JWT_SECRET, { expiresIn: '5m' })
}

const PROVISIONAL_USER = { ...TEST_USER, verification_token: 'pending-token-123', verification_sent_at: new Date().toISOString() }
const VERIFIED_USER = { ...TEST_USER, verification_token: null, verification_sent_at: null }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Email Verification', () => {
  let authApp
  let userApp

  beforeEach(async () => {
    const express = await import('express')
    authApp = express.default()
    authApp.use('/auth/', await getAuthRouter())

    userApp = express.default()
    userApp.use('/user/', await getUserRouter())
  })

  // ---- POST /auth/verify-email ----
  describe('POST /auth/verify-email', () => {
    it('returns 400 when the token field is missing', async () => {
      const res = await request(authApp).post('/auth/verify-email').send({})
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/required/i)
    })

    it('returns 400 when no account holds the token', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)

      const res = await request(authApp).post('/auth/verify-email').send({ token: 'no-such-token' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/invalid/i)
      expect(mockPrisma.user.update).not.toHaveBeenCalled()
    })

    it('clears the stored token and timestamp when it matches an account', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(PROVISIONAL_USER)
      mockPrisma.user.update.mockResolvedValue(VERIFIED_USER)

      const res = await request(authApp).post('/auth/verify-email').send({ token: 'pending-token-123' })
      expect(res.status).toBe(200)
      expect(res.body.message).toMatch(/verified/i)

      // The matching account's token data must be cleared
      const updateCall = mockPrisma.user.update.mock.calls[0][0]
      expect(updateCall.where).toEqual({ id: TEST_USER.id })
      expect(updateCall.data.verification_token).toBeNull()
      expect(updateCall.data.verification_sent_at).toBeNull()
    })

    it('returns 410 when the token is past its 15-minute lifetime', async () => {
      const stale = { ...PROVISIONAL_USER, verification_sent_at: new Date(Date.now() - 16 * 60_000).toISOString() }
      mockPrisma.user.findFirst.mockResolvedValue(stale)

      const res = await request(authApp).post('/auth/verify-email').send({ token: 'pending-token-123' })
      expect(res.status).toBe(410)
      expect(res.body.error).toMatch(/expired/i)
      // Expired tokens are not consumed; the account can request a fresh one
      expect(mockPrisma.user.update).not.toHaveBeenCalled()
    })

    it('returns 500 when the database fails', async () => {
      mockPrisma.user.findFirst.mockRejectedValue(new Error('DB down'))

      const res = await request(authApp).post('/auth/verify-email').send({ token: 'x' })
      expect(res.status).toBe(500)
      expect(res.body.error).toMatch(/failed/i)
    })
  })

  // ---- POST /auth/resend-verification ----
  describe('POST /auth/resend-verification', () => {
    it('returns 401 when no session token is provided', async () => {
      const res = await request(authApp).post('/auth/resend-verification')
      expect(res.status).toBe(401)
    })

    it('reissues the token and emails a fresh link for a provisional user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(PROVISIONAL_USER)
      mockPrisma.user.update.mockImplementation(async ({ data }) => ({ ...PROVISIONAL_USER, ...data }))

      const res = await request(authApp)
        .post('/auth/resend-verification')
        .set('Authorization', `Bearer ${makeToken()}`)
      expect(res.status).toBe(200)
      expect(res.body.message).toMatch(/sent/i)

      // A new token + timestamp replaces the old one (expiry is refreshed)
      const updateCall = mockPrisma.user.update.mock.calls[0][0]
      expect(updateCall.where).toEqual({ id: TEST_USER.id })
      expect(updateCall.data.verification_token).toMatch(/^[a-f0-9]{64}$/)
      expect(updateCall.data.verification_token).not.toBe('pending-token-123')
      expect(updateCall.data.verification_sent_at).toBeInstanceOf(Date)

      // The fresh link carries the new token
      const [emailedUser, emailedToken] = mockMailer.sendVerificationEmail.mock.calls[0]
      expect(emailedUser.email).toBe(TEST_USER.email)
      expect(emailedToken).toBe(updateCall.data.verification_token)
    })

    it('returns 400 for an already-verified user (nothing to resend)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(VERIFIED_USER)

      const res = await request(authApp)
        .post('/auth/resend-verification')
        .set('Authorization', `Bearer ${makeToken()}`)
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/already verified/i)
      expect(mockPrisma.user.update).not.toHaveBeenCalled()
      expect(mockMailer.sendVerificationEmail).not.toHaveBeenCalled()
    })

    it('returns 502 when email delivery fails (token still reissued)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(PROVISIONAL_USER)
      mockPrisma.user.update.mockImplementation(async ({ data }) => ({ ...PROVISIONAL_USER, ...data }))
      mockMailer.sendVerificationEmail.mockRejectedValueOnce(new Error('SMTP down'))

      const res = await request(authApp)
        .post('/auth/resend-verification')
        .set('Authorization', `Bearer ${makeToken()}`)
      expect(res.status).toBe(502)
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1)
    })
  })

  // ---- Provisional account access control ----
  describe('Provisional account access control', () => {
    it('blocks /auth/me for an unverified user (403)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(PROVISIONAL_USER)

      const res = await request(authApp)
        .get('/auth/me')
        .set('Authorization', `Bearer ${makeToken()}`)
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/not verified/i)
    })

    it('allows /auth/me for a verified user (200)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(VERIFIED_USER)

      const res = await request(authApp)
        .get('/auth/me')
        .set('Authorization', `Bearer ${makeToken()}`)
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(TEST_USER.id)
    })

    it('blocks protected user routes for an unverified user (403)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(PROVISIONAL_USER)

      const res = await request(userApp)
        .get('/user/list/*')
        .set('Authorization', `Bearer ${makeToken({ type: 'ADMIN' })}`)
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/not verified/i)
    })

    it('allows protected user routes for a verified user (200)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(VERIFIED_USER)
      mockPrisma.user.findMany.mockResolvedValue([])
      mockPrisma.user.aggregate.mockResolvedValue({ _count: { _all: 0 } })

      const res = await request(userApp)
        .get('/user/list/*')
        .set('Authorization', `Bearer ${makeToken({ type: 'ADMIN' })}`)
      expect(res.status).toBe(200)
    })

    it('lets deleted users fall through to the route (404, not 403)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)

      const res = await request(userApp)
        .get('/user/999')
        .set('Authorization', `Bearer ${makeToken({ type: 'TEACHER' })}`)
      expect(res.status).toBe(404)
    })
  })

  // ---- Token issuance on account creation ----
  describe('Token issuance on account creation', () => {
    it('stores a verification token and timestamp, then emails the link', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockImplementation(async ({ data }) => ({ ...TEST_USER, ...data }))

      const res = await request(userApp)
        .post('/user/create')
        .set('Authorization', `Bearer ${makeToken({ type: 'ADMIN' })}`)
        .send({ username: 'newbie', email: 'new@example.com', password: 'secret' })

      expect(res.status).toBe(201)

      // The account is born provisional: random token + send timestamp stored
      const createCall = mockPrisma.user.create.mock.calls[0][0]
      expect(createCall.data.verification_token).toMatch(/^[a-f0-9]{64}$/)
      expect(createCall.data.verification_sent_at).toBeInstanceOf(Date)

      // The emailed link must carry the stored token for this account
      expect(mockMailer.sendVerificationEmail).toHaveBeenCalledTimes(1)
      const [emailedUser, emailedToken] = mockMailer.sendVerificationEmail.mock.calls[0]
      expect(emailedUser.email).toBe('new@example.com')
      expect(emailedToken).toBe(createCall.data.verification_token)

      // The token itself is never exposed in the response
      expect(res.body.user).not.toHaveProperty('verification_token')
    })

    it('still creates the account when email delivery fails', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockImplementation(async ({ data }) => ({ ...TEST_USER, ...data }))
      mockMailer.sendVerificationEmail.mockRejectedValueOnce(new Error('SMTP down'))

      const res = await request(userApp)
        .post('/user/create')
        .set('Authorization', `Bearer ${makeToken({ type: 'ADMIN' })}`)
        .send({ username: 'newbie', email: 'new@example.com', password: 'secret' })

      expect(res.status).toBe(201)

      // Account stays provisional (token stored) even though the mail failed
      const createCall = mockPrisma.user.create.mock.calls[0][0]
      expect(createCall.data.verification_token).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  // ---- Bootstrap token issuance ----
  describe('Bootstrap token issuance', () => {
    it('issues a verification token for the initial admin account', async () => {
      mockPrisma.user.count.mockResolvedValue(0)
      mockPrisma.user.create.mockImplementation(async ({ data }) => ({ ...TEST_USER, type: 'ADMIN', ...data }))

      const res = await request(authApp)
        .post('/auth/bootstrap')
        .send({ token: makeBootstrapToken(), username: 'root', email: 'root@example.com', password: 'secret' })

      expect(res.status).toBe(201)

      const createCall = mockPrisma.user.create.mock.calls[0][0]
      expect(createCall.data.verification_token).toMatch(/^[a-f0-9]{64}$/)
      expect(createCall.data.verification_sent_at).toBeInstanceOf(Date)
      expect(mockMailer.sendVerificationEmail).toHaveBeenCalledTimes(1)
    })
  })
})
