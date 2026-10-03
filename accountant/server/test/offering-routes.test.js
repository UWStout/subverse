import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { mockPrisma, TEST_OFFERING } from './setup.js'
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
const CLS = { id: 1, subject: 'CS', number: '101', title: 'Intro CS' }

describe('Offering API Routes', () => {
  let router
  let app

  beforeEach(async () => {
    router = await getOfferingRouter()
    const express = await import('express')
    app = express.default()
    app.use('/offering/', router)
  })

  // ---- GET /list ----
  describe('GET /offering/list', () => {
    it('returns all offerings with class and teacher details when no filters', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([TEST_OFFERING])
      mockPrisma.offering.aggregate.mockResolvedValue({ _count: { _all: 1 } })

      const res = await request(app).get('/offering/list')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.total).toBe(1)
      expect(res.body.page).toBe(1)
      expect(res.body.limit).toBe(25)
      expect(res.body.totalPages).toBe(1)
      // No filter applied
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} })
      )
    })

    it('applies term, section, class_id and teacher_id filters', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([])
      mockPrisma.offering.aggregate.mockResolvedValue({ _count: { _all: 0 } })

      const res = await request(app).get('/offering/list?term=FALL2025&section=A&class_id=1&teacher_id=2')
      expect(res.status).toBe(200)
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { term: 'FALL2025', section: 'A', class_id: 1, teacher_id: 2 }
        })
      )
    })

    it('treats term=* as no filter', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([])
      mockPrisma.offering.aggregate.mockResolvedValue({ _count: { _all: 0 } })

      await request(app).get('/offering/list?term=*&section=A')
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { section: 'A' } })
      )
    })

    it('paginates results with skip/take', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([])
      mockPrisma.offering.aggregate.mockResolvedValue({ _count: { _all: 30 } })

      const res = await request(app).get('/offering/list?page=2&limit=10')
      expect(res.status).toBe(200)
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      )
      expect(res.body.totalPages).toBe(3)
    })

    it('caps limit at 100', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([])
      mockPrisma.offering.aggregate.mockResolvedValue({ _count: { _all: 0 } })

      await request(app).get('/offering/list?limit=500')
      expect(mockPrisma.offering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      )
    })

    it('returns 500 on database error', async () => {
      mockPrisma.offering.findMany.mockRejectedValue(new Error('DB down'))

      const res = await request(app).get('/offering/list')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to list offerings' })
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

    it('returns 400 when the selected user is not a teacher', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(CLS)
      mockPrisma.user.findUnique.mockResolvedValue(STUDENT)

      const res = await request(app)
        .post('/offering/create')
        .send({ class_id: 1, teacher_id: 2, term: 'FALL2025', section: 'A' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('not a teacher')
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

    it('returns 400 when the new teacher is not a teacher', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.class.findUnique.mockResolvedValue(CLS)
      mockPrisma.user.findUnique.mockResolvedValue(STUDENT)

      const res = await request(app)
        .post('/offering/update/1')
        .send({ teacher_id: 2 })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('not a teacher')
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
