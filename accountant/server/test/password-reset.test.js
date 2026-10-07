import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { mockPrisma, mockMailer, TEST_USER } from './setup.js'
import path from 'path'

// ---------------------------------------------------------------------------
// Dynamic import to get a fresh router per test (clears ESM cache + lazy getDb)
// ---------------------------------------------------------------------------
async function getAuthRouter () {
  vi.resetModules()
  const routePath = path.resolve(__dirname, '..', 'routes', 'auth.js')
  const mod = await import(routePath)
  return mod.default
}

const RESET_TOKEN = 'reset-token-abc123'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Password Reset Flow', () => {
  let app

  beforeEach(async () => {
    const express = await import('express')
    app = express.default()
    app.use('/auth/', await getAuthRouter())
  })

  // ---- POST /auth/forgot-password ----
  describe('POST /auth/forgot-password', () => {
    it('returns 400 when identifier is missing', async () => {
      const res = await request(app).post('/auth/forgot-password').send({})
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/required/i)
    })

    it('issues a reset token and emails the link when the account is found by email', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(TEST_USER)
      mockPrisma.user.update.mockImplementation(async ({ data }) => ({ ...TEST_USER, ...data }))

      const res = await request(app).post('/auth/forgot-password').send({ identifier: TEST_USER.email })
      expect(res.status).toBe(200)
      expect(res.body.message).toMatch(/if an account matches/i)

      // The stored token data is set in the same write
      const updateCall = mockPrisma.user.update.mock.calls[0][0]
      expect(updateCall.where).toEqual({ id: TEST_USER.id })
      expect(updateCall.data.reset_token).toMatch(/^[a-f0-9]{64}$/)
      expect(updateCall.data.reset_sent_at).toBeInstanceOf(Date)

      // The emailed link carries the stored token
      expect(mockMailer.sendPasswordResetEmail).toHaveBeenCalledTimes(1)
      const [emailedUser, emailedToken] = mockMailer.sendPasswordResetEmail.mock.calls[0]
      expect(emailedUser.email).toBe(TEST_USER.email)
      expect(emailedToken).toBe(updateCall.data.reset_token)
    })

    it('finds the account by username as well', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(TEST_USER)
      mockPrisma.user.update.mockImplementation(async ({ data }) => ({ ...TEST_USER, ...data }))

      const res = await request(app).post('/auth/forgot-password').send({ identifier: TEST_USER.username })
      expect(res.status).toBe(200)
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ username: TEST_USER.username }, { email: TEST_USER.username }] }
      })
      expect(mockMailer.sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    })

    it('responds identically when no account matches (no enumeration)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)

      const res = await request(app).post('/auth/forgot-password').send({ identifier: 'ghost@example.com' })
      expect(res.status).toBe(200)
      // Same generic message as the found case
      expect(res.body.message).toMatch(/if an account matches/i)
      expect(mockPrisma.user.update).not.toHaveBeenCalled()
      expect(mockMailer.sendPasswordResetEmail).not.toHaveBeenCalled()
    })

    it('still responds 200 when email delivery fails', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(TEST_USER)
      mockPrisma.user.update.mockImplementation(async ({ data }) => ({ ...TEST_USER, ...data }))
      mockMailer.sendPasswordResetEmail.mockRejectedValueOnce(new Error('SMTP down'))

      const res = await request(app).post('/auth/forgot-password').send({ identifier: TEST_USER.email })
      expect(res.status).toBe(200)
    })

    it('returns 500 when the database fails', async () => {
      mockPrisma.user.findFirst.mockRejectedValue(new Error('DB down'))

      const res = await request(app).post('/auth/forgot-password').send({ identifier: 'x' })
      expect(res.status).toBe(500)
    })
  })

  // ---- POST /auth/reset-password ----
  describe('POST /auth/reset-password', () => {
    it('returns 400 when token or password is missing', async () => {
      const res = await request(app).post('/auth/reset-password').send({ token: RESET_TOKEN })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/required/i)

      const res2 = await request(app).post('/auth/reset-password').send({ password: 'newpass' })
      expect(res2.status).toBe(400)
    })

    it('sets a new password and clears the token when it matches', async () => {
      const holder = { ...TEST_USER, reset_token: RESET_TOKEN, reset_sent_at: new Date().toISOString() }
      mockPrisma.user.findFirst.mockResolvedValue(holder)
      mockPrisma.user.update.mockImplementation(async ({ data }) => ({ ...holder, ...data }))

      const res = await request(app).post('/auth/reset-password').send({ token: RESET_TOKEN, password: 'brand-new-secret' })
      expect(res.status).toBe(200)
      expect(res.body.message).toMatch(/reset/i)

      // The new password is hashed; the token data is cleared in one write
      expect(bcrypt.hash).toHaveBeenCalledWith('brand-new-secret', 10)
      const updateCall = mockPrisma.user.update.mock.calls[0][0]
      expect(updateCall.where).toEqual({ id: TEST_USER.id })
      expect(updateCall.data.password_hash).toBe('$2a$10$hashedpassword')
      expect(updateCall.data.reset_token).toBeNull()
      expect(updateCall.data.reset_sent_at).toBeNull()
    })

    it('returns 400 when no account holds the token', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)

      const res = await request(app).post('/auth/reset-password').send({ token: 'nope', password: 'x' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/invalid/i)
      expect(mockPrisma.user.update).not.toHaveBeenCalled()
    })

    it('returns 410 when the token is past its lifetime', async () => {
      const stale = { ...TEST_USER, reset_token: RESET_TOKEN, reset_sent_at: new Date(Date.now() - 16 * 60_000).toISOString() }
      mockPrisma.user.findFirst.mockResolvedValue(stale)

      const res = await request(app).post('/auth/reset-password').send({ token: RESET_TOKEN, password: 'x' })
      expect(res.status).toBe(410)
      expect(res.body.error).toMatch(/expired/i)
      // Expired tokens are not consumed; a new request can be made
      expect(mockPrisma.user.update).not.toHaveBeenCalled()
    })

    it('returns 500 when the database fails', async () => {
      mockPrisma.user.findFirst.mockRejectedValue(new Error('DB down'))

      const res = await request(app).post('/auth/reset-password').send({ token: RESET_TOKEN, password: 'x' })
      expect(res.status).toBe(500)
    })
  })
})
