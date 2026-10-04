import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { mockPrisma, TEST_OFFERING, authedApp } from './setup.js'
import path from 'path'

// ---------------------------------------------------------------------------
// Dynamic import to get a fresh router per test (clears ESM cache + lazy getDb)
// ---------------------------------------------------------------------------
async function getOfferingRouter () {
  vi.resetModules()
  const routePath = path.resolve(__dirname, '..', 'routes', 'offering.js')
  const mod = await import(routePath)
  return mod.default
}

const TEACHER = { id: 1, username: 'prof', email: 'prof@uni.edu', type: 'TEACHER' }
const STUDENT = { id: 2, username: 'student', email: 'stu@uni.edu', type: 'STUDENT' }
const ADMIN = { id: 3, username: 'admin', email: 'adm@uni.edu', type: 'ADMIN' }
const CLS = { id: 1, subject: 'CS', number: '101', title: 'Intro CS' }

describe('Offering API Routes', () => {
  let router
  let app

  beforeEach(async () => {
    router = await getOfferingRouter()
    // Wrap so every request carries a valid session token (authenticated client)
    const express = await import('express')
    const rawApp = express.default()
    rawApp.use('/offering/', router)
    app = authedApp(rawApp)
  })

  // ---- GET /list/:term/:class_id/:teacher_id ----
  describe('GET /offering/list/:term/:class_id/:teacher_id', () => {
    it('returns plain offering rows (no joins) when no filters', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([TEST_OFFERING])
      mockPrisma.offering.aggregate.mockResolvedValue({ _count: { _all: 1 } })

      const res = await request(app).get('/offering/list/*/*/*')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.total).toBe(1)
      expect(res.body.page).toBe(1)
      expect(res.body.limit).toBe(25)
      expect(res.body.totalPages).toBe(1)
      // No filter applied, and no include / join on the query
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 25,
        orderBy: [{ term: 'asc' }, { section: 'asc' }, { id: 'asc' }]
      })
      // Rows carry only the raw offering fields (class_id / teacher_id, no details)
      expect(res.body.data[0]).toEqual(TEST_OFFERING)
      expect(res.body.data[0]).not.toHaveProperty('class')
      expect(res.body.data[0]).not.toHaveProperty('teacher')
    })

    it('applies term, class_id and teacher_id filters from the URL positions', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([])
      mockPrisma.offering.aggregate.mockResolvedValue({ _count: { _all: 0 } })

      const res = await request(app).get('/offering/list/FALL2025/1/2')
      expect(res.status).toBe(200)
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { term: 'FALL2025', class_id: 1, teacher_id: 2 }
        })
      )
    })

    it('treats a single * position as no filter for that position', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([])
      mockPrisma.offering.aggregate.mockResolvedValue({ _count: { _all: 0 } })

      await request(app).get('/offering/list/*/1/*')
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { class_id: 1 } })
      )
    })

    it('returns 400 when class_id is neither numeric nor *', async () => {
      const res = await request(app).get('/offering/list/*/abc/*')
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('class_id')
    })

    it('returns 400 when teacher_id is neither numeric nor *', async () => {
      const res = await request(app).get('/offering/list/*/*/xyz')
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('teacher_id')
    })

    it('paginates results with skip/take from query params', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([])
      mockPrisma.offering.aggregate.mockResolvedValue({ _count: { _all: 30 } })

      const res = await request(app).get('/offering/list/*/*/*?page=2&limit=10')
      expect(res.status).toBe(200)
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      )
      expect(res.body.totalPages).toBe(3)
    })

    it('caps limit at 100', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([])
      mockPrisma.offering.aggregate.mockResolvedValue({ _count: { _all: 0 } })

      await request(app).get('/offering/list/*/*/*?limit=500')
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      )
    })

    it('returns 500 on database error', async () => {
      mockPrisma.offering.findMany.mockRejectedValue(new Error('DB down'))

      const res = await request(app).get('/offering/list/*/*/*')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to list offerings' })
    })
  })

  // ---- GET /:id (details) ----
  describe('GET /offering/:id', () => {
    it('returns the offering with class, teacher and project IDs', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue({
        id: 1,
        class_id: 1,
        teacher_id: 1,
        term: 'FALL2025',
        section: 'A',
        class: { id: 1, subject: 'CS', number: '101', title: 'Intro CS' },
        teacher: { id: 1, username: 'prof', email: 'prof@uni.edu' },
        projects: [{ id: 5 }, { id: 9 }]
      })

      const res = await request(app).get('/offering/1')
      expect(res.status).toBe(200)
      expect(mockPrisma.offering.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } })
      )
      expect(res.body.id).toBe(1)
      expect(res.body.term).toBe('FALL2025')
      expect(res.body.class).toEqual({ id: 1, subject: 'CS', number: '101', title: 'Intro CS' })
      expect(res.body.teacher).toEqual({ id: 1, username: 'prof', email: 'prof@uni.edu' })
      expect(res.body.project_ids).toEqual([5, 9])
    })

    it('returns an empty project ID list when the offering has no projects', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue({
        ...TEST_OFFERING,
        class: CLS,
        teacher: TEACHER,
        projects: []
      })

      const res = await request(app).get('/offering/1')
      expect(res.status).toBe(200)
      expect(res.body.project_ids).toEqual([])
    })

    it('returns 400 for non-numeric ID', async () => {
      const res = await request(app).get('/offering/abc')
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid offering ID' })
    })

    it('returns 404 when the offering does not exist', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(null)

      const res = await request(app).get('/offering/999')
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Offering not found' })
    })

    it('returns 500 on database error', async () => {
      mockPrisma.offering.findUnique.mockRejectedValue(new Error('DB down'))

      const res = await request(app).get('/offering/1')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to retrieve offering' })
    })
  })

  // ---- GET /terms ----
  describe('GET /offering/terms', () => {
    it('returns the distinct sorted term values', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([
        { term: 'FALL2025' },
        { term: 'SPRING2026' }
      ])

      const res = await request(app).get('/offering/terms')
      expect(res.status).toBe(200)
      expect(res.body.terms).toEqual(['FALL2025', 'SPRING2026'])
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith({
        distinct: ['term'],
        select: { term: true },
        orderBy: { term: 'asc' }
      })
    })

    it('returns an empty list when no offerings exist', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([])

      const res = await request(app).get('/offering/terms')
      expect(res.status).toBe(200)
      expect(res.body.terms).toEqual([])
    })

    it('returns 500 on database error', async () => {
      mockPrisma.offering.findMany.mockRejectedValue(new Error('DB down'))

      const res = await request(app).get('/offering/terms')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to list offering terms' })
    })
  })

  // ---- POST /create ----
  describe('POST /offering/create', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/offering/create')
        .send({ class_id: 1, teacher_id: 1 })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Missing required fields')
    })

    it('returns 400 when class_id or teacher_id is not numeric', async () => {
      const res = await request(app)
        .post('/offering/create')
        .send({ class_id: 'abc', teacher_id: 1, term: 'FALL2025', section: 'A' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('numeric')
    })

    it('returns 404 when the class does not exist', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(null)
      mockPrisma.user.findUnique.mockResolvedValue(TEACHER)

      const res = await request(app)
        .post('/offering/create')
        .send({ class_id: 99, teacher_id: 1, term: 'FALL2025', section: 'A' })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Class not found' })
    })

    it('returns 404 when the teacher does not exist', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(CLS)
      mockPrisma.user.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .post('/offering/create')
        .send({ class_id: 1, teacher_id: 99, term: 'FALL2025', section: 'A' })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Teacher not found' })
    })

    it('returns 400 when the selected user is not a teacher or admin', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(CLS)
      mockPrisma.user.findUnique.mockResolvedValue(STUDENT)

      const res = await request(app)
        .post('/offering/create')
        .send({ class_id: 1, teacher_id: 2, term: 'FALL2025', section: 'A' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('not a teacher or admin')
    })

    it('allows an admin account to be selected as instructor', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(CLS)
      mockPrisma.user.findUnique.mockResolvedValue(ADMIN)
      mockPrisma.offering.findUnique.mockResolvedValue(null)
      mockPrisma.offering.create.mockResolvedValue(TEST_OFFERING)

      const res = await request(app)
        .post('/offering/create')
        .send({ class_id: 1, teacher_id: 3, term: 'FALL2025', section: 'A' })
      expect(res.status).toBe(201)
      expect(mockPrisma.offering.create).toHaveBeenCalledWith({
        data: { class_id: 1, teacher_id: 3, term: 'FALL2025', section: 'A' }
      })
    })

    it('returns 409 when the class + term + section combination already exists', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(CLS)
      mockPrisma.user.findUnique.mockResolvedValue(TEACHER)
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)

      const res = await request(app)
        .post('/offering/create')
        .send({ class_id: 1, teacher_id: 1, term: 'FALL2025', section: 'A' })
      expect(res.status).toBe(409)
      expect(res.body.error).toContain('already exists')
    })

    it('creates a new offering successfully', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(CLS)
      mockPrisma.user.findUnique.mockResolvedValue(TEACHER)
      mockPrisma.offering.findUnique.mockResolvedValue(null)
      mockPrisma.offering.create.mockResolvedValue(TEST_OFFERING)

      const res = await request(app)
        .post('/offering/create')
        .send({ class_id: 1, teacher_id: 1, term: 'FALL2025', section: 'A' })
      expect(res.status).toBe(201)
      expect(mockPrisma.offering.create).toHaveBeenCalledWith({
        data: { class_id: 1, teacher_id: 1, term: 'FALL2025', section: 'A' }
      })
      expect(res.body.id).toBe(TEST_OFFERING.id)
    })

    it('returns 500 on database error', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(CLS)
      mockPrisma.user.findUnique.mockResolvedValue(TEACHER)
      mockPrisma.offering.create.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .post('/offering/create')
        .send({ class_id: 1, teacher_id: 1, term: 'FALL2025', section: 'A' })
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to create offering' })
    })
  })

  // ---- POST /update/:id ----
  describe('POST /offering/update/:id', () => {
    it('returns 400 for non-numeric ID', async () => {
      const res = await request(app)
        .post('/offering/update/abc')
        .send({})
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid offering ID' })
    })

    it('returns 400 when no update fields are provided', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)

      const res = await request(app)
        .post('/offering/update/1')
        .send({})
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'No update fields provided' })
    })

    it('returns 404 when offering does not exist', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .post('/offering/update/999')
        .send({ section: 'B' })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Offering not found' })
    })

    it('updates term and section successfully', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.offering.update.mockResolvedValue({ ...TEST_OFFERING, term: 'SPRING2026', section: 'B' })

      const res = await request(app)
        .post('/offering/update/1')
        .send({ term: 'SPRING2026', section: 'B' })
      expect(res.status).toBe(200)
      expect(mockPrisma.offering.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { term: 'SPRING2026', section: 'B' }
      })
      expect(res.body.term).toBe('SPRING2026')
    })

    it('validates the new class when class_id changes', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.class.findUnique.mockResolvedValue(CLS)
      mockPrisma.user.findUnique.mockResolvedValue(TEACHER)
      mockPrisma.offering.update.mockResolvedValue({ ...TEST_OFFERING, class_id: 2 })

      const res = await request(app)
        .post('/offering/update/1')
        .send({ class_id: 2 })
      expect(res.status).toBe(200)
      expect(mockPrisma.offering.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { class_id: 2 } })
      )
    })

    it('returns 404 when the new class does not exist', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.class.findUnique.mockResolvedValue(null)
      mockPrisma.user.findUnique.mockResolvedValue(TEACHER)

      const res = await request(app)
        .post('/offering/update/1')
        .send({ class_id: 99 })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Class not found' })
    })

    it('returns 400 when the new teacher is not a teacher or admin', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.class.findUnique.mockResolvedValue(CLS)
      mockPrisma.user.findUnique.mockResolvedValue(STUDENT)

      const res = await request(app)
        .post('/offering/update/1')
        .send({ teacher_id: 2 })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('not a teacher or admin')
    })

    it('allows reassigning the instructor to an admin account', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.class.findUnique.mockResolvedValue(CLS)
      mockPrisma.user.findUnique.mockResolvedValue(ADMIN)
      mockPrisma.offering.update.mockResolvedValue({ ...TEST_OFFERING, teacher_id: 3 })

      const res = await request(app)
        .post('/offering/update/1')
        .send({ teacher_id: 3 })
      expect(res.status).toBe(200)
      expect(mockPrisma.offering.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { teacher_id: 3 }
      })
    })

    it('returns 409 when the new combination conflicts with another offering', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.class.findUnique.mockResolvedValue(CLS)
      mockPrisma.user.findUnique.mockResolvedValue(TEACHER)
      // Uniqueness check finds a different offering
      mockPrisma.offering.findUnique.mockResolvedValueOnce(TEST_OFFERING)
      mockPrisma.offering.findUnique.mockResolvedValue({ ...TEST_OFFERING, id: 2 })

      const res = await request(app)
        .post('/offering/update/1')
        .send({ section: 'A' })
      expect(res.status).toBe(409)
      expect(res.body.error).toContain('already exists')
    })

    it('allows keeping the same combination (no self-conflict)', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      // Uniqueness check finds the offering itself
      mockPrisma.offering.findUnique.mockResolvedValueOnce(TEST_OFFERING)
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.offering.update.mockResolvedValue({ ...TEST_OFFERING, section: 'C' })

      const res = await request(app)
        .post('/offering/update/1')
        .send({ section: 'C' })
      expect(res.status).toBe(200)
    })

    it('returns 500 on database error', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.offering.update.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .post('/offering/update/1')
        .send({ section: 'B' })
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to update offering' })
    })
  })

  // ---- DELETE /:id ----
  describe('DELETE /offering/:id', () => {
    it('returns 400 for non-numeric ID', async () => {
      const res = await request(app).delete('/offering/abc')
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid offering ID' })
    })

    it('returns 404 when offering does not exist', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(null)

      const res = await request(app).delete('/offering/999')
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Offering not found' })
    })

    it('deletes an offering successfully', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.offering.delete.mockResolvedValue(TEST_OFFERING)

      const res = await request(app).delete('/offering/1')
      expect(res.status).toBe(200)
      expect(mockPrisma.offering.delete).toHaveBeenCalledWith({ where: { id: 1 } })
      expect(res.body.message).toMatch(/delet/i)
    })

    it('returns 500 on database error during deletion', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.offering.delete.mockRejectedValue(new Error('DB down'))

      const res = await request(app).delete('/offering/1')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to delete offering' })
    })
  })
})

// ---------------------------------------------------------------------------
// Authentication â€” every route on this router requires a valid session token
// ---------------------------------------------------------------------------
describe('Authentication', () => {
  let app

  beforeEach(async () => {
    const router = await getOfferingRouter()
    const express = await import('express')
    app = express.default()
    app.use('/offering/', router)
  })

  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/offering/list/*/*/*')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/authorization/i)
  })

  it('returns 401 for a malformed Authorization header', async () => {
    const res = await request(app)
      .get('/offering/list/*/*/*')
      .set('Authorization', 'Token abc123')
    expect(res.status).toBe(401)
  })

  it('returns 401 for a token signed with the wrong secret', async () => {
    const badToken = jwt.sign({ sub: 1, username: 'testuser' }, 'wrong-secret', { expiresIn: '8h' })
    const res = await request(app)
      .get('/offering/list/*/*/*')
      .set('Authorization', `Bearer ${badToken}`)
    expect(res.status).toBe(401)
  })
})
