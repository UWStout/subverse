import { Router, json } from 'express'
import { getDatabase } from '../db.js'
import { authenticate } from '../middleware/auth.js'
import { validateClassSubject, validateClassNumber } from '../../shared/validate.js'

// Lazily resolve the database client on first request (avoids ESM init-order issues)
let db
function getDb () {
  if (!db) db = getDatabase()
  return db
}

const classRouter = new Router()

// Install Json body parser
classRouter.use(json())

// All class routes require a valid session token
classRouter.use(authenticate)

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
 * Strip nested sensitive data and return summarized class info.
 * Prisma returns _count: { offerings: N }, not the raw array.
 */
function summarizeClass (cls) {
  const { _count, ...safe } = cls
  return {
    ...safe,
    offering_count: _count?.offerings ?? 0
  }
}

// --- Routes (specific paths first, parameterized last) ---

// Get list of classes with server-side pagination.
// Filters are positional URL params; '*' means "any" for that position:
//   GET /class/list/:subject/:number
// Only pagination (?page=N&limit=N) is passed as query params.
classRouter.get('/list/:subject/:number', async (req, res) => {
  try {
    const { subject, number } = req.params

    const where = {}
    if (subject && subject !== '*') where.subject = subject
    if (number && number !== '*') where.number = number

    const { skip, take, page } = parsePagination(req.query)

    const [classes, agg] = await Promise.all([
      getDb().class.findMany({
        where,
        skip,
        take,
        include: { _count: { select: { offerings: true } } },
        orderBy: { id: 'asc' }
      }),
      getDb().class.aggregate({ where, _count: { _all: true } })
    ])
    const total = agg._count._all

    res.json({
      data: classes.map(summarizeClass),
      total,
      page,
      limit: take,
      totalPages: Math.ceil(total / take)
    })
  } catch (err) {
    console.error('Error listing classes:', err)
    res.status(500).json({ error: 'Failed to list classes' })
  }
})

// Get details on a class
classRouter.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid class ID' })
    }

    const cls = await getDb().class.findUnique({
      where: { id },
      include: {
        offerings: {
          include: {
            teacher: { select: { id: true, username: true, email: true } },
            projects: true
          }
        }
      }
    })

    if (!cls) {
      return res.status(404).json({ error: 'Class not found' })
    }

    res.json(cls)
  } catch (err) {
    console.error('Error retrieving class:', err)
    res.status(500).json({ error: 'Failed to retrieve class' })
  }
})

// Create Class post route
classRouter.post('/create', async (req, res) => {
  try {
    // Students have no access to class management
    if (req.user.type === 'STUDENT') {
      return res.status(403).json({ error: 'Students cannot create classes' })
    }

    const { subject, number, title } = req.body

    // Validate required fields
    if (!subject || !number || !title) {
      return res.status(400).json({ error: 'Missing required fields: subject, number, title' })
    }

    // Validate field patterns (rules live in config/validation-rules.js)
    const subjectError = validateClassSubject(subject)
    if (subjectError) {
      return res.status(400).json({ error: subjectError })
    }
    const numberError = validateClassNumber(number)
    if (numberError) {
      return res.status(400).json({ error: numberError })
    }

    // Check for duplicate subject + number combination
    const existing = await getDb().class.findUnique({
      where: {
        subject_number: { subject, number }
      }
    })

    if (existing) {
      return res.status(409).json({ error: 'Class already exists with this subject and number' })
    }

    const cls = await getDb().class.create({
      data: { subject, number, title }
    })

    res.status(201).json(cls)
  } catch (err) {
    console.error('Error creating class:', err)
    res.status(500).json({ error: 'Failed to create class' })
  }
})

// Update Class post route
classRouter.post('/update/:id', async (req, res) => {
  try {
    // Students have no access to class management
    if (req.user.type === 'STUDENT') {
      return res.status(403).json({ error: 'Students cannot update classes' })
    }

    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid class ID' })
    }

    const { subject, number, title } = req.body

    // Validate that at least one field is provided
    if (!subject && !number && !title) {
      return res.status(400).json({ error: 'No update fields provided' })
    }

    // Validate patterns for any class fields being changed
    const subjectError = subject !== undefined ? validateClassSubject(subject) : null
    const numberError = number !== undefined ? validateClassNumber(number) : null
    if (subjectError || numberError) {
      return res.status(400).json({ error: subjectError || numberError })
    }

    // Check class exists
    const existing = await getDb().class.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ error: 'Class not found' })
    }

    // Check uniqueness of subject + number if either changed
    if (subject !== undefined || number !== undefined) {
      const dup = await getDb().class.findUnique({
        where: {
          subject_number: {
            subject: subject ?? existing.subject,
            number: number ?? existing.number
          }
        }
      })
      if (dup && dup.id !== id) {
        return res.status(409).json({ error: 'Another class already exists with this subject and number' })
      }
    }

    const updated = await getDb().class.update({
      where: { id },
      data: {
        ...(subject !== undefined && { subject }),
        ...(number !== undefined && { number }),
        ...(title !== undefined && { title })
      }
    })

    res.json(updated)
  } catch (err) {
    console.error('Error updating class:', err)
    res.status(500).json({ error: 'Failed to update class' })
  }
})

// Delete class route
classRouter.delete('/:id', async (req, res) => {
  try {
    // Students have no access to class management
    if (req.user.type === 'STUDENT') {
      return res.status(403).json({ error: 'Students cannot delete classes' })
    }

    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid class ID' })
    }

    // Check class exists
    const existing = await getDb().class.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ error: 'Class not found' })
    }

    // A class with offerings cannot be deleted; delete the offerings first.
    const offeringCount = await getDb().offering.count({ where: { class_id: id } })
    if (offeringCount > 0) {
      return res.status(409).json({ error: 'Cannot delete a class that has offerings. Delete its offerings first.' })
    }

    await getDb().class.delete({ where: { id } })

    res.json({ message: 'Class deleted successfully' })
  } catch (err) {
    console.error('Error deleting class:', err)
    res.status(500).json({ error: 'Failed to delete class' })
  }
})

export default classRouter
