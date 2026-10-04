import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { mockPrisma, TEST_CLASS, authedApp, makeToken } from './setup.js'
import path from 'path'

// ---------------------------------------------------------------------------
// Dynamic import to get a fresh router per test (clears ESM cache + lazy getDb)
// ---------------------------------------------------------------------------
async function getClassRouter () {
  vi.resetModules()
  const routePath = path.resolve(__dirname, '..', 'routes', 'class.js')
  const mod = await import(routePath)
  return mod.default
}

// Role tokens for exercising the permission rules (the default session is a student)
const TEACHER_TOKEN = makeToken({ sub: 20, username: 'teacher', type: 'TEACHER' })
const ADMIN_TOKEN = makeToken({ sub: 10, username: 'admin', type: 'ADMIN' })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Class API Routes', () => {
  let router
  let app

  beforeEach(async () => {
    router = await getClassRouter()
    // Wrap so every request carries a valid session token (authenticated client)
    const express = await import('express')
    const rawApp = express.default()
    rawApp.use('/class/', router)
    app = authedApp(rawApp)
  })

  // ---- GET /list/:subject/:number ----
  describe('GET /class/list/:subject/:number', () => {
    it('returns classes with offering_count when no filters are given', async () => {
      mockPrisma.class.aggregate.mockResolvedValue({ _count: { _all: 2 } })
      mockPrisma.class.findMany.mockResolvedValue([
        { id: 1, subject: 'CS', number: '101', title: 'Intro CS', _count: { offerings: 3 } },
        { id: 2, subject: 'MATH', number: '201', title: 'Calculus I', _count: { offerings: 1 } }
      ])

      const res = await request(app).get('/class/list/*/*')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data).toHaveLength(2)
      // summarizeClass extracts _count.offerings into offering_count
      expect(res.body.data[0].offering_count).toBe(3)
      expect(res.body.data[1].offering_count).toBe(1)
      expect(res.body.data[0]).not.toHaveProperty('_count')
      expect(res.body.total).toBe(2)
      expect(res.body.page).toBe(1)
      expect(res.body.limit).toBe(25)
      // No filters -> empty where clause, and no offering join is performed
      expect(mockPrisma.class.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
      expect(mockPrisma.offering.findMany).not.toHaveBeenCalled()
    })

    it('filters by subject when provided', async () => {
      mockPrisma.class.aggregate.mockResolvedValue({ _count: { _all: 1 } })
      mockPrisma.class.findMany.mockResolvedValue([
        { id: 1, subject: 'CS', number: '101', title: 'Intro CS', _count: { offerings: 0 } }
      ])

      const res = await request(app).get('/class/list/CS/*')
      expect(res.status).toBe(200)
      expect(mockPrisma.class.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { subject: 'CS' } }))
    })

    it('filters by number when provided', async () => {
      mockPrisma.class.aggregate.mockResolvedValue({ _count: { _all: 1 } })
      mockPrisma.class.findMany.mockResolvedValue([
        { id: 1, subject: 'CS', number: '101', title: 'Intro CS', _count: { offerings: 0 } }
      ])

      const res = await request(app).get('/class/list/*/101')
      expect(res.status).toBe(200)
      expect(mockPrisma.class.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { number: '101' } }))
    })

    it('filters by both subject and number', async () => {
      mockPrisma.class.aggregate.mockResolvedValue({ _count: { _all: 1 } })
      mockPrisma.class.findMany.mockResolvedValue([
        { id: 1, subject: 'CS', number: '101', title: 'Intro CS', _count: { offerings: 0 } }
      ])

      const res = await request(app).get('/class/list/CS/101')
      expect(res.status).toBe(200)
      expect(mockPrisma.class.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { subject: 'CS', number: '101' } }))
    })

    it('returns 500 on database error', async () => {
      mockPrisma.class.findMany.mockRejectedValue(new Error('DB down'))

      const res = await request(app).get('/class/list/*/*')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to list classes' })
    })
  })

  // ---- GET /:id ----
  describe('GET /class/:id', () => {
    it('returns 400 for non-numeric ID', async () => {
      const res = await request(app).get('/class/abc')
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid class ID' })
    })

    it('returns 404 when class does not exist', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(null)

      const res = await request(app).get('/class/999')
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Class not found' })
    })

    it('returns class with nested offerings, teachers, and projects', async () => {
      const clsWithOfferings = {
        ...TEST_CLASS,
        offerings: [
          {
            id: 1,
            term: 'FALL2025',
            section: 'A',
            teacher: { id: 1, username: 'prof', email: 'prof@uni.edu' },
            projects: [{ id: 1, title: 'Final Project' }]
          }
        ]
      }
      mockPrisma.class.findUnique.mockResolvedValue(clsWithOfferings)

      const res = await request(app).get('/class/1')
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(1)
      expect(res.body.offerings).toHaveLength(1)
      expect(res.body.offerings[0].teacher.username).toBe('prof')
      expect(res.body.offerings[0].projects).toHaveLength(1)
    })

    it('returns 500 on database error', async () => {
      mockPrisma.class.findUnique.mockRejectedValue(new Error('DB down'))

      const res = await request(app).get('/class/1')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to retrieve class' })
    })
  })

  // ---- POST /create ----
  describe('POST /class/create', () => {
    it('returns 403 for students', async () => {
      const res = await request(app)
        .post('/class/create')
        .send({ subject: 'CS', number: '101', title: 'New Class' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/students/i)
    })

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/class/create')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ subject: 'CS' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Missing required fields')
    })

    it('returns 409 when subject+number combination already exists', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)

      const res = await request(app)
        .post('/class/create')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ subject: 'CS', number: '101', title: 'Duplicate' })
      expect(res.status).toBe(409)
      expect(res.body.error).toContain('already exists')
    })

    it('creates a new class successfully (teacher)', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(null)
      mockPrisma.class.create.mockResolvedValue(TEST_CLASS)

      const res = await request(app)
        .post('/class/create')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ subject: 'CS', number: '101', title: 'Intro to Computer Science' })
      expect(res.status).toBe(201)
      expect(res.body.subject).toBe('CS')
      expect(res.body.number).toBe('101')
      expect(res.body.title).toBe('Intro to Computer Science')
    })

    it('creates a new class successfully (admin)', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(null)
      mockPrisma.class.create.mockResolvedValue({ ...TEST_CLASS, subject: 'MATH', number: '201' })

      const res = await request(app)
        .post('/class/create')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ subject: 'MATH', number: '201', title: 'Calculus I' })
      expect(res.status).toBe(201)
    })

    it('returns 500 on database error', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(null)
      mockPrisma.class.create.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .post('/class/create')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ subject: 'CS', number: '101', title: 'New Class' })
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to create class' })
    })
  })

  // ---- POST /update/:id ----
  describe('POST /class/update/:id', () => {
    it('returns 403 for students', async () => {
      const res = await request(app)
        .post('/class/update/1')
        .send({ title: 'New Title' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/students/i)
    })

    it('returns 400 for non-numeric ID', async () => {
      const res = await request(app)
        .post('/class/update/abc')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({})
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid class ID' })
    })

    it('returns 400 when no update fields are provided', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)

      const res = await request(app)
        .post('/class/update/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({})
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'No update fields provided' })
    })

    it('returns 404 when class does not exist', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .post('/class/update/999')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ title: 'New Title' })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Class not found' })
    })

    it('updates title successfully', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.class.update.mockResolvedValue({ ...TEST_CLASS, title: 'Updated Title' })

      const res = await request(app)
        .post('/class/update/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ title: 'Updated Title' })
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Updated Title')
    })

    it('updates title successfully (admin)', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.class.update.mockResolvedValue({ ...TEST_CLASS, title: 'Updated Title' })

      const res = await request(app)
        .post('/class/update/1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ title: 'Updated Title' })
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Updated Title')
    })

    it('updates subject successfully', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.class.findUnique.mockResolvedValueOnce(TEST_CLASS) // existence check
      mockPrisma.class.findUnique.mockResolvedValue(null) // uniqueness check passes
      mockPrisma.class.update.mockResolvedValue({ ...TEST_CLASS, subject: 'CSCI' })

      const res = await request(app)
        .post('/class/update/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ subject: 'CSCI' })
      expect(res.status).toBe(200)
      expect(res.body.subject).toBe('CSCI')
    })

    it('updates number successfully', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.class.findUnique.mockResolvedValueOnce(TEST_CLASS) // existence check
      mockPrisma.class.findUnique.mockResolvedValue(null) // uniqueness check passes
      mockPrisma.class.update.mockResolvedValue({ ...TEST_CLASS, number: '201' })

      const res = await request(app)
        .post('/class/update/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ number: '201' })
      expect(res.status).toBe(200)
      expect(res.body.number).toBe('201')
    })

    it('returns 409 when subject+number conflicts with another class', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.class.findUnique.mockResolvedValueOnce(TEST_CLASS) // existence check
      mockPrisma.class.findUnique.mockResolvedValue({ id: 2, subject: 'CS', number: '101' }) // conflict

      const res = await request(app)
        .post('/class/update/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ subject: 'CS', number: '101' })
      expect(res.status).toBe(409)
      expect(res.body.error).toContain('already exists')
    })

    it('updates multiple fields at once', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.class.findUnique.mockResolvedValueOnce(TEST_CLASS) // existence check
      mockPrisma.class.findUnique.mockResolvedValue(null) // uniqueness check passes
      mockPrisma.class.update.mockResolvedValue({
        id: 1, subject: 'CSCI', number: '201', title: 'Updated CS'
      })

      const res = await request(app)
        .post('/class/update/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ subject: 'CSCI', number: '201', title: 'Updated CS' })
      expect(res.status).toBe(200)
      expect(res.body.subject).toBe('CSCI')
      expect(res.body.number).toBe('201')
      expect(res.body.title).toBe('Updated CS')
    })

    it('returns 500 on database error', async () => {
      mockPrisma.class.findUnique.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .post('/class/update/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ title: 'x' })
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to update class' })
    })
  })

  // ---- DELETE /:id ----
  describe('DELETE /class/:id', () => {
    it('returns 403 for students', async () => {
      const res = await request(app).delete('/class/1')
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/students/i)
    })

    it('returns 400 for non-numeric ID', async () => {
      const res = await request(app)
        .delete('/class/abc')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid class ID' })
    })

    it('returns 404 when class does not exist', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .delete('/class/999')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Class not found' })
    })

    it('deletes a class successfully when it has no offerings (teacher)', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.offering.count.mockResolvedValue(0)
      mockPrisma.class.delete.mockResolvedValue(TEST_CLASS)

      const res = await request(app)
        .delete('/class/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(200)
      expect(res.body.message).toMatch(/delet/i)
    })

    it('deletes a class successfully when it has no offerings (admin)', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.offering.count.mockResolvedValue(0)
      mockPrisma.class.delete.mockResolvedValue(TEST_CLASS)

      const res = await request(app)
        .delete('/class/1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(200)
    })

    it('returns 409 and deletes nothing when the class still has offerings', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.offering.count.mockResolvedValue(2)

      const res = await request(app)
        .delete('/class/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/offerings/i)
      // No cascade: neither the offerings nor the class are deleted
      expect(mockPrisma.offering.deleteMany).not.toHaveBeenCalled()
      expect(mockPrisma.class.delete).not.toHaveBeenCalled()
    })

    it('returns 500 on database error during lookup', async () => {
      mockPrisma.class.findUnique.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .delete('/class/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to delete class' })
    })

    it('returns 500 on database error during deletion', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.offering.count.mockResolvedValue(0)
      mockPrisma.class.delete.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .delete('/class/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to delete class' })
    })
  })
})

// ---------------------------------------------------------------------------
// Authentication - every route on this router requires a valid session token
// ---------------------------------------------------------------------------
describe('Authentication', () => {
  let app

  beforeEach(async () => {
    const router = await getClassRouter()
    const express = await import('express')
    app = express.default()
    app.use('/class/', router)
  })

  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/class/list/*/*')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/authorization/i)
  })

  it('returns 401 for a malformed Authorization header', async () => {
    const res = await request(app)
      .get('/class/list/*/*')
      .set('Authorization', 'Token abc123')
    expect(res.status).toBe(401)
  })

  it('returns 401 for a token signed with the wrong secret', async () => {
    const badToken = jwt.sign({ sub: 1, username: 'testuser' }, 'wrong-secret', { expiresIn: '8h' })
    const res = await request(app)
      .get('/class/list/*/*')
      .set('Authorization', `Bearer ${badToken}`)
    expect(res.status).toBe(401)
  })
})
