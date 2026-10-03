/* eslint-disable camelcase */
import { Router, json } from 'express'
import { getDatabase } from '../db.js'

// Lazily resolve the database client on first request (avoids ESM init-order issues)
let db
function getDb () {
  if (!db) db = getDatabase()
  return db
}

const offeringRouter = new Router()

// Install Json body parser
offeringRouter.use(json())

/**
 * Parse ?page=N&limit=N query params into pagination values.
 * Defaults: page=1, limit=25.  Caps limit at maxLimit.
 * Returns { skip, take, page }
 */
function parsePagination (query, maxLimit = 100) {
  let page = parseInt(query.page, 10) || 1
  let limit = parseInt(query.limit, 10) || 25
  if (page < 1) page = 1
  if (limit < 1) limit = 1
  if (limit > maxLimit) limit = maxLimit
  return { skip: (page - 1) * limit, take: limit, page }
}

/**
 * Build a Prisma `where` clause from the optional list filters
 * (?term=*, ?section=, ?class_id=, ?teacher_id=).
 */
function buildWhere (query) {
  const where = {}
  if (query.term && query.term !== '*') where.term = query.term
  if (query.section) where.section = query.section
  if (query.class_id) where.class_id = parseInt(query.class_id, 10)
  if (query.teacher_id) where.teacher_id = parseInt(query.teacher_id, 10)
  return where
}

/** Fields included with each offering in list responses. */
const OFFERING_INCLUDE = {
  class: { select: { id: true, subject: true, number: true, title: true } },
  teacher: { select: { id: true, username: true, email: true } }
}

// --- Routes (specific paths first, parameterized last) ---

// Get list of offerings with server-side pagination.
// Optional filters: ?term=*, ?section=, ?class_id=N, ?teacher_id=N
offeringRouter.get('/list', async (req, res) => {
  try {
    const where = buildWhere(req.query)
    const { skip, take, page } = parsePagination(req.query)

    const [offerings, agg] = await Promise.all([
      getDb().offering.findMany({
        where,
        skip,
        take,
        include: OFFERING_INCLUDE,
        orderBy: [{ term: 'asc' }, { section: 'asc' }, { id: 'asc' }]
      }),
      getDb().offering.aggregate({ where, _count: { _all: true } })
    ])

    res.json({
      data: offerings,
      total: agg._count._all,
      page,
      limit: take,
      totalPages: Math.ceil(agg._count._all / take)
    })
  } catch (err) {
    console.error('Error listing offerings:', err)
    res.status(500).json({ error: 'Failed to list offerings' })
  }
})

// Get the distinct set of terms that have at least one offering.
// Used by the client to build term filter chips.
offeringRouter.get('/terms', async (req, res) => {
  try {
    const rows = await getDb().offering.findMany({
      distinct: ['term'],
      select: { term: true },
      orderBy: { term: 'asc' }
    })

    res.json({ terms: rows.map(r => r.term) })
  } catch (err) {
    console.error('Error listing offering terms:', err)
    res.status(500).json({ error: 'Failed to list offering terms' })
  }
})

/**
 * Validate that a class and teacher exist (and the teacher has type TEACHER).
 * Returns the found records or null when either lookup fails.
 */
async function validateClassAndTeacher (class_id, teacher_id) {
  const [cls, teacher] = await Promise.all([
    getDb().class.findUnique({ where: { id: class_id } }),
    getDb().user.findUnique({ where: { id: teacher_id } })
  ])
  if (!cls || !teacher || teacher.type !== 'TEACHER') return null
  return { cls, teacher }
}

// Create a new offering for a class / teacher / term / section combination
offeringRouter.post('/create', async (req, res) => {
  try {
    const { class_id, teacher_id, term, section } = req.body

    // Validate required fields
    if (!class_id || !teacher_id || !term || !section) {
      return res.status(400).json({ error: 'Missing required fields: class_id, teacher_id, term, section' })
    }

    const clsId = parseInt(class_id, 10)
    const teacherId = parseInt(teacher_id, 10)
    if (isNaN(clsId) || isNaN(teacherId)) {
      return res.status(400).json({ error: 'class_id and teacher_id must be numeric' })
    }

    // Verify the referenced class and teacher exist
    const validated = await validateClassAndTeacher(clsId, teacherId)
    if (!validated) {
      const cls = await getDb().class.findUnique({ where: { id: clsId } })
      if (!cls) return res.status(404).json({ error: 'Class not found' })
      const teacher = await getDb().user.findUnique({ where: { id: teacherId } })
      if (!teacher) return res.status(404).json({ error: 'Teacher not found' })
      return res.status(400).json({ error: 'Selected user is not a teacher' })
    }

    // Check for duplicate class + term + section combination
    const existing = await getDb().offering.findUnique({
      where: { class_id_term_section: { class_id: clsId, term, section } }
    })
    if (existing) {
      return res.status(409).json({ error: 'An offering for this class already exists in this term and section' })
    }

    const offering = await getDb().offering.create({
      data: { class_id: clsId, teacher_id: teacherId, term, section }
    })

    res.status(201).json(offering)
  } catch (err) {
    console.error('Error creating offering:', err)
    res.status(500).json({ error: 'Failed to create offering' })
  }
})

// Update an existing offering (any subset of class_id, teacher_id, term, section)
offeringRouter.post('/update/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid offering ID' })
    }

    const { class_id, teacher_id, term, section } = req.body

    // Validate that at least one field is provided
    if (class_id === undefined && teacher_id === undefined && term === undefined && section === undefined) {
      return res.status(400).json({ error: 'No update fields provided' })
    }

    // Check offering exists
    const existing = await getDb().offering.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ error: 'Offering not found' })
    }

    // Resolve final values (new value when provided, otherwise current)
    const newClassId = class_id !== undefined ? parseInt(class_id, 10) : existing.class_id
    const newTeacherId = teacher_id !== undefined ? parseInt(teacher_id, 10) : existing.teacher_id
    if (isNaN(newClassId) || isNaN(newTeacherId)) {
      return res.status(400).json({ error: 'class_id and teacher_id must be numeric' })
    }

    // Validate referenced class / teacher when either is being changed
    if (class_id !== undefined || teacher_id !== undefined) {
      const validated = await validateClassAndTeacher(newClassId, newTeacherId)
      if (!validated) {
        const cls = await getDb().class.findUnique({ where: { id: newClassId } })
        if (!cls) return res.status(404).json({ error: 'Class not found' })
        const teacher = await getDb().user.findUnique({ where: { id: newTeacherId } })
        if (!teacher) return res.status(404).json({ error: 'Teacher not found' })
        return res.status(400).json({ error: 'Selected user is not a teacher' })
      }
    }

    const newTerm = term !== undefined ? term : existing.term
    const newSection = section !== undefined ? section : existing.section

    // Check uniqueness of class + term + section if any part changed
    if (class_id !== undefined || term !== undefined || section !== undefined) {
      const dup = await getDb().offering.findUnique({
        where: { class_id_term_section: { class_id: newClassId, term: newTerm, section: newSection } }
      })
      if (dup && dup.id !== id) {
        return res.status(409).json({ error: 'Another offering already exists for this class, term and section' })
      }
    }

    const updated = await getDb().offering.update({
      where: { id },
      data: {
        ...(class_id !== undefined && { class_id: newClassId }),
        ...(teacher_id !== undefined && { teacher_id: newTeacherId }),
        ...(term !== undefined && { term }),
        ...(section !== undefined && { section })
      }
    })

    res.json(updated)
  } catch (err) {
    console.error('Error updating offering:', err)
    res.status(500).json({ error: 'Failed to update offering' })
  }
})

// Delete an offering (its projects and assignments are cascade-deleted)
offeringRouter.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid offering ID' })
    }

    // Check offering exists
    const existing = await getDb().offering.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ error: 'Offering not found' })
    }

    await getDb().offering.delete({ where: { id } })

    res.json({ message: 'Offering deleted successfully' })
  } catch (err) {
    console.error('Error deleting offering:', err)
    res.status(500).json({ error: 'Failed to delete offering' })
  }
})

export default offeringRouter
