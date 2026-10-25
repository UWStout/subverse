/* eslint-disable camelcase */
import { Router, json } from 'express'
import { getDatabase } from '../db.js'
import { authenticate, requireVerified } from '../middleware/auth.js'
import { validateTerm, validateSection } from '../../shared/validate.js'

// Lazily resolve the database client on first request (avoids ESM init-order issues)
let db
function getDb () {
  if (!db) db = getDatabase()
  return db
}

const offeringRouter = new Router()

// Install Json body parser
offeringRouter.use(json())

// All offering routes require a valid session token
offeringRouter.use(authenticate)

// ...and a verified (non-provisional) email address
offeringRouter.use(requireVerified)

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
 * Build a Prisma `where` clause from the list route's positional filter
 * params (:term, :class_id, :teacher_id). A value of '*' means "any"
 * (no filter) for that position. The teacher position filters offerings
 * that list the given user as ONE of their (possibly several) teachers.
 */
function buildWhere (params) {
  const where = {}
  if (params.term && params.term !== '*') where.term = params.term
  if (params.class_id && params.class_id !== '*') where.class_id = parseInt(params.class_id, 10)
  if (params.teacher_id && params.teacher_id !== '*') where.teachers = { some: { id: parseInt(params.teacher_id, 10) } }
  return where
}

// --- Routes (specific paths first, parameterized last) ---

// Get list of offerings with server-side pagination.
// Filters are positional URL params; '*' means "any" for that position:
//   GET /offering/list/:term/:class_id/:teacher_id
// Only pagination (?page=N&limit=N) is passed as query params.
offeringRouter.get('/list/:term/:class_id/:teacher_id', async (req, res) => {
  try {
    const { class_id, teacher_id } = req.params

    // Non-wildcard ID filters must be numeric
    if (class_id !== '*' && isNaN(parseInt(class_id, 10))) {
      return res.status(400).json({ error: 'Invalid class_id, expected a number or *' })
    }
    if (teacher_id !== '*' && isNaN(parseInt(teacher_id, 10))) {
      return res.status(400).json({ error: 'Invalid teacher_id, expected a number or *' })
    }

    const where = buildWhere(req.params)
    const { skip, take, page } = parsePagination(req.query)

    // Rows carry a light teachers join (id + username) so the list table can
    // show co-teachers without a second request; the full expansion (class
    // details, emails, project IDs) lives on GET /offering/:id.
    const [offerings, agg] = await Promise.all([
      getDb().offering.findMany({
        where,
        skip,
        take,
        orderBy: [{ term: 'asc' }, { section: 'asc' }, { id: 'asc' }],
        include: { teachers: { select: { id: true, username: true }, orderBy: { id: 'asc' } } }
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

// Get full details for a specific offering (joined with class and teacher
// details plus the projects belonging to it, one level deep)
offeringRouter.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid offering ID' })
    }

    const offering = await getDb().offering.findUnique({
      where: { id },
      include: {
        class: { select: { id: true, subject: true, number: true, title: true } },
        teachers: { select: { id: true, username: true, email: true }, orderBy: { id: 'asc' } },
        projects: {
          select: { id: true, title: true, slug: true, repository_url: true, repository_type: true },
          orderBy: { id: 'asc' }
        }
      }
    })

    if (!offering) {
      return res.status(404).json({ error: 'Offering not found' })
    }

    // Return the offering with its project list (and a flat ID list for
    // backwards compatibility)
    const { projects, ...rest } = offering
    res.json({ ...rest, project_ids: projects.map(p => p.id), projects })
  } catch (err) {
    console.error('Error retrieving offering:', err)
    res.status(500).json({ error: 'Failed to retrieve offering' })
  }
})

/**
 * Validate a class and a list of instructor IDs. Instructors may be TEACHER
 * or ADMIN. Returns { cls, teachers } or null when any lookup fails.
 */
async function validateClassAndTeachers (class_id, teacher_ids) {
  const [cls, teachers] = await Promise.all([
    getDb().class.findUnique({ where: { id: class_id } }),
    getDb().user.findMany({ where: { id: { in: teacher_ids } } })
  ])
  if (!cls || teachers.length !== new Set(teacher_ids).size) return null
  if (teachers.some(t => !['TEACHER', 'ADMIN'].includes(t.type))) return null
  return { cls, teachers }
}

// Create a new offering for a class / term / section combination with one or
// more co-teachers (teacher_ids: non-empty array of user IDs)
offeringRouter.post('/create', async (req, res) => {
  try {
    const { class_id, teacher_ids, term, section } = req.body

    // Validate required fields
    if (!class_id || !Array.isArray(teacher_ids) || teacher_ids.length === 0 || !term || !section) {
      return res.status(400).json({ error: 'Missing required fields: class_id, teacher_ids (non-empty array), term, section' })
    }

    // Validate field patterns (rules live in config/validation-rules.js)
    const termError = validateTerm(term)
    if (termError) {
      return res.status(400).json({ error: termError })
    }
    const sectionError = validateSection(section)
    if (sectionError) {
      return res.status(400).json({ error: sectionError })
    }

    const clsId = parseInt(class_id, 10)
    const teacherIds = teacher_ids.map(t => parseInt(t, 10))
    if (isNaN(clsId) || teacherIds.some(isNaN)) {
      return res.status(400).json({ error: 'class_id and teacher_ids must be numeric' })
    }

    // Verify the referenced class and all teachers exist and are eligible
    const validated = await validateClassAndTeachers(clsId, [...new Set(teacherIds)])
    if (!validated) {
      const cls = await getDb().class.findUnique({ where: { id: clsId } })
      if (!cls) return res.status(404).json({ error: 'Class not found' })
      const teachers = await getDb().user.findMany({ where: { id: { in: teacherIds } } })
      if (teachers.length !== new Set(teacherIds).size) return res.status(404).json({ error: 'Teacher not found' })
      return res.status(400).json({ error: 'Selected user is not a teacher or admin' })
    }

    // Check for duplicate class + term + section combination
    const existing = await getDb().offering.findUnique({
      where: { class_id_term_section: { class_id: clsId, term, section } }
    })
    if (existing) {
      return res.status(409).json({ error: 'An offering for this class already exists in this term and section' })
    }

    const offering = await getDb().offering.create({
      data: {
        class_id: clsId,
        term,
        section,
        teachers: { connect: [...new Set(teacherIds)].map(id => ({ id })) }
      }
    })

    res.status(201).json(offering)
  } catch (err) {
    console.error('Error creating offering:', err)
    res.status(500).json({ error: 'Failed to create offering' })
  }
})

// Update an existing offering (any subset of class_id, teacher_ids, term,
// section). teacher_ids REPLACES the full co-teacher list when provided.
offeringRouter.post('/update/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid offering ID' })
    }

    const { class_id, teacher_ids, term, section } = req.body

    // Validate that at least one field is provided
    if (class_id === undefined && teacher_ids === undefined && term === undefined && section === undefined) {
      return res.status(400).json({ error: 'No update fields provided' })
    }

    // Validate patterns for any offering fields being changed
    const termError = term !== undefined ? validateTerm(term) : null
    const sectionError = section !== undefined ? validateSection(section) : null
    if (termError || sectionError) {
      return res.status(400).json({ error: termError || sectionError })
    }

    // Check offering exists
    const existing = await getDb().offering.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ error: 'Offering not found' })
    }

    // Resolve final values (new value when provided, otherwise current)
    const newClassId = class_id !== undefined ? parseInt(class_id, 10) : existing.class_id
    if (isNaN(newClassId)) {
      return res.status(400).json({ error: 'class_id must be numeric' })
    }
    let newTeacherIds
    if (teacher_ids !== undefined) {
      if (!Array.isArray(teacher_ids) || teacher_ids.length === 0) {
        return res.status(400).json({ error: 'teacher_ids must be a non-empty array of user IDs' })
      }
      newTeacherIds = [...new Set(teacher_ids.map(t => parseInt(t, 10)))]
      if (newTeacherIds.some(isNaN)) {
        return res.status(400).json({ error: 'teacher_ids must contain only numeric user IDs' })
      }
    }

    // Validate referenced class / teachers when either is being changed
    if (class_id !== undefined || teacher_ids !== undefined) {
      const currentTeacherIds = newTeacherIds ?? (await getDb().offering.findUnique({ where: { id }, include: { teachers: { select: { id: true } } } })).teachers.map(t => t.id)
      const validated = await validateClassAndTeachers(newClassId, currentTeacherIds)
      if (!validated) {
        const cls = await getDb().class.findUnique({ where: { id: newClassId } })
        if (!cls) return res.status(404).json({ error: 'Class not found' })
        const teachers = await getDb().user.findMany({ where: { id: { in: currentTeacherIds } } })
        if (teachers.length !== new Set(currentTeacherIds).size) return res.status(404).json({ error: 'Teacher not found' })
        return res.status(400).json({ error: 'Selected user is not a teacher or admin' })
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
        // Replacing the whole co-teacher list is delete-all + connect-new
        ...(teacher_ids !== undefined && { teachers: { set: newTeacherIds.map(id => ({ id })) } }),
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
