import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { mockPrisma, TEST_USER, TEST_JWT_SECRET } from './setup.js'
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

function makeToken (overrides = {}) {
  return jwt.sign(
    { sub: TEST_USER.id, username: 'testuser', type: 'STUDENT', ...overrides },
    TEST_JWT_SECRET,
    { expiresIn: '8h' }
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Auth API Routes', () => {
  let router
  let app

  beforeEach(async () => {
    router = await getAuthRouter()
    const express = await import('express')
    app = express.default()
    app.use('/auth/', router)
  })

  // ---- POST /login ----
  describe('POST /auth/login', () => {
    it('returns 400 when username or password is missing', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'testuser' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/required/i)
    })

    it('returns 401 when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'ghost', password: 'nope' })
      expect(res.status).toBe(401)
      expect(res.body.error).toMatch(/invalid/i)
    })

    it('returns 401 when the password does not match', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      bcrypt.compare.mockResolvedValueOnce(false)

      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'testuser', password: 'wrong' })
      expect(res.status).toBe(401)
      expect(res.body.error).toMatch(/invalid/i)
    })

    it('returns a verifiable token and sanitized user on success', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'testuser', password: 'secret' })
      expect(res.status).toBe(200)
      expect(res.body.token).toBeTruthy()

      // The token must be a JWT carrying the user identity
      const payload = jwt.verify(res.body.token, TEST_JWT_SECRET)
      expect(payload.sub).toBe(TEST_USER.id)
      expect(payload.username).toBe('testuser')
      expect(payload.type).toBe('STUDENT')

      expect(res.body.user).not.toHaveProperty('password_hash')
    })
  })

  // ---- GET /me ----
  describe('GET /auth/me', () => {
    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get('/auth/me')
      expect(res.status).toBe(401)
    })

    it('returns 401 for a malformed or invalid token', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Bearer not.a.jwt')
      expect(res.status).toBe(401)
    })

    it('returns the current user for a valid token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${makeToken()}`)
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(TEST_USER.id)
      expect(res.body.username).toBe('testuser')
    })

    it('returns 401 when the token user no longer exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${makeToken()}`)
      expect(res.status).toBe(401)
    })
  })
})
