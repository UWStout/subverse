import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { mockPrisma, TEST_USER, TEST_CLASS } from './setup.js'
import path from 'path'

// ---------------------------------------------------------------------------
// Dynamic import to get a fresh router per test (clears ESM cache + lazy getDb)
// ---------------------------------------------------------------------------
async function getClassRouter () {
  vi.resetModules()
  const routePath = path.resolve(__dirname, '..', 'server', 'routes', 'class.js')
  const mod = await import(routePath)
  return mod.default
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Class API Routes', () => {
  let router
  let app

  beforeEach(async () => {
    router = await getClassRouter()
    const express = await import('express')
    app = express.default()
    app.use('/class/', router)
  })

  // ---- GET /list/:term/:teacher ----
  describe('GET /class/list/:term/:teacher', () => {
    it('returns classes with _count.offerings when no filters (*/*)', async () => {
      // NOTE: summarizeClass() reads cls.offerings?.length, but Prisma returns
      // _count: { offerings: N }.  The current code spreads _count into the
      // response and sets offering_count to 0 (since offerings is undefined).
      // This test documents actual behavior; fix server/routes/class.js to use
      // _count.offerings instead of offerings.length in summarizeClass().
      mockPrisma.class.findMany.mockResolvedValue([
        { id: 1, subject: 'CS', number: '101', title: 'Intro CS', _count: { offerings: 3 } },
        { id: 2, subject: 'MATH', number: '201', title: 'Calculus I', _count: { offerings: 1 } }
      ])

      const res = await request(app).get('/class/list/*/*')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body).toHaveLength(2)
      // _count is spread into the response by summarizeClass's rest-spread
      expect(res.body[0]._count.offerings).toBe(3)
      expect(res.body[0]).not.toHaveProperty('offerings')
    })

    it('filters by term when provided', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([
        {
          id: 1,
          class: { id: 1, subject: 'CS', number: '101', title: 'Intro CS', offerings: [] }
        }
      ])

      const res = await request(app).get('/class/list/FALL2025/*')
      expect(res.status).toBe(200)
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ term: 'FALL2025' })
        })
      )
    })

    it('filters by teacher_id when provided', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([])

      const res = await request(app).get('/class/list/*/5')
      expect(res.status).toBe(200)
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ teacher_id: 5 })
        })
      )
    })

    it('filters by both term and teacher_id', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([])

      const res = await request(app).get('/class/list/SPRING2026/3')
      expect(res.status).toBe(200)
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            term: 'SPRING2026',
            teacher_id: 3
          })
        })
      )
    })

    it('deduplicates classes when multiple offerings match', async () => {
      const cls = { id: 1, subject: 'CS', number: '101', title: 'Intro CS', offerings: [] }
      mockPrisma.offering.findMany.mockResolvedValue([
        { id: 1, class: cls },
        { id: 2, class: cls },
        { id: 3, class: cls }
      ])

      const res = await request(app).get('/class/list/FALL2025/*')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
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
    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/class/create')
        .send({ subject: 'CS' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Missing required fields')
    })

    it('returns 409 when subject+number combination already exists', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)

      const res = await request(app)
        .post('/class/create')
        .send({ subject: 'CS', number: '101', title: 'Duplicate' })
      expect(res.status).toBe(409)
      expect(res.body.error).toContain('already exists')
    })

    it('creates a new class successfully', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(null)
      mockPrisma.class.create.mockResolvedValue(TEST_CLASS)

      const res = await request(app)
        .post('/class/create')
        .send({ subject: 'CS', number: '101', title: 'Intro to Computer Science' })
      expect(res.status).toBe(201)
      expect(res.body.subject).toBe('CS')
      expect(res.body.number).toBe('101')
      expect(res.body.title).toBe('Intro to Computer Science')
    })

    it('returns 500 on database error', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(null)
      mockPrisma.class.create.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .post('/class/create')
        .send({ subject: 'CS', number: '101', title: 'New Class' })
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to create class' })
    })
  })

  // ---- POST /update/:id ----
  describe('POST /class/update/:id', () => {
    it('returns 400 for non-numeric ID', async () => {
      const res = await request(app)
        .post('/class/update/abc')
        .send({})
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid class ID' })
    })

    it('returns 400 when no update fields are provided', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)

      const res = await request(app)
        .post('/class/update/1')
        .send({})
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'No update fields provided' })
    })

    it('returns 404 when class does not exist', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .post('/class/update/999')
        .send({ title: 'New Title' })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Class not found' })
    })

    it('updates title successfully', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.class.update.mockResolvedValue({ ...TEST_CLASS, title: 'Updated Title' })

      const res = await request(app)
        .post('/class/update/1')
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
        .send({ title: 'x' })
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to update class' })
    })
  })
})
