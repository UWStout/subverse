/* eslint-disable camelcase */
import { Router, json } from 'express'
import { getDatabase } from '../db.js'
import { authenticate } from '../middleware/auth.js'

// Lazily resolve the database client on first request (avoids ESM init-order issues)
let db
function getDb () {
  if (!db) db = getDatabase()
  return db
}

const projectRouter = new Router()

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

// Install Json body parser
projectRouter.use(json())

// All project routes require a valid session token
projectRouter.use(authenticate)

/**
 * Parse a subject-number class code (e.g. "CS-101").
 * Returns { subject, number } or null if invalid / wildcard.
 */
function parseClassCode (code) {
  if (!code || code === '*') return null
  const idx = code.lastIndexOf('-')
  if (idx < 1) return null
  const subject = code.slice(0, idx)
  const number = code.slice(idx + 1)
  if (!/^[A-Za-z]+$/.test(subject) || !/^\d+$/.test(number)) return null
  return { subject, number }
}

/**
 * Proper slug format: lowercase latin letters and digits only, with single
 * hyphens between segments (e.g. "final-project").
 * Rejects spaces, uppercase, non-latin characters, and any special character
 * that is unsafe in URLs or file paths.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SLUG_ERROR = 'Invalid slug format, expected lowercase letters and numbers separated by single hyphens (e.g. final-project)'

function isValidSlug (slug) {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug)
}

// --- Routes (specific paths first, parameterized last) ---

// Create Project post route
projectRouter.post('/create', async (req, res) => {
  try {
    const { offering_id, title, slug, subversion_url, git_url, description } = req.body

    // Validate required fields
    if (!offering_id || !title || !slug) {
      return res.status(400).json({ error: 'Missing required fields: offering_id, title, and slug are required' })
    }

    // Validate slug format (must be URL / file path safe)
    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: SLUG_ERROR })
    }

    // Verify the offering exists
    const offering = await getDb().offering.findUnique({ where: { id: parseInt(offering_id, 10) } })
    if (!offering) {
      return res.status(404).json({ error: 'Offering not found' })
    }

    const project = await getDb().project.create({
      data: {
        offering_id: parseInt(offering_id, 10),
        title,
        slug,
        subversion_url: subversion_url ?? null,
        git_url: git_url ?? null,
        description: description ?? null
      }
    })

    res.status(201).json(project)
  } catch (err) {
    console.error('Error creating project:', err)
    res.status(500).json({ error: 'Failed to create project' })
  }
})

// Update Project post route
projectRouter.post('/update/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid project ID' })
    }

    const { offering_id, title, slug, subversion_url, git_url, description } = req.body

    // Validate that at least one update field is provided
    if (title === undefined && slug === undefined && subversion_url === undefined && git_url === undefined && description === undefined && offering_id === undefined) {
      return res.status(400).json({ error: 'No update fields provided' })
    }

    // Validate slug format if it is being changed (must be URL / file path safe)
    if (slug !== undefined && !isValidSlug(slug)) {
      return res.status(400).json({ error: SLUG_ERROR })
    }

    // Check project exists
    const existing = await getDb().project.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ error: 'Project not found' })
    }

    // Validate new offering_id if it is being changed
    if (offering_id !== undefined) {
      const newOffering = await getDb().offering.findUnique({ where: { id: parseInt(offering_id, 10) } })
      if (!newOffering) {
        return res.status(404).json({ error: 'Offering not found' })
      }
    }

    const updated = await getDb().project.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(slug !== undefined && { slug }),
        ...(subversion_url !== undefined && { subversion_url: subversion_url ?? null }),
        ...(git_url !== undefined && { git_url: git_url ?? null }),
        ...(description !== undefined && { description }),
        ...(offering_id !== undefined && { offering_id: parseInt(offering_id, 10) })
      }
    })

    res.json(updated)
  } catch (err) {
    console.error('Error updating project:', err)
    res.status(500).json({ error: 'Failed to update project' })
  }
})

// Get list of projects optionally filtered by class offering (subject-number) and/or term
projectRouter.get('/:class/:term', async (req, res) => {
  try {
    const { class: classCode, term } = req.params

    // Must provide at least one filter
    if (classCode === '*' && term === '*') {
      return res.status(400).json({ error: 'At least one filter (class or term) is required' })
    }

    const { skip, take, page } = parsePagination(req.query)

    // Parse class code if provided (not wildcard)
    let classId = null
    if (classCode !== '*') {
      const parsed = parseClassCode(classCode)
      if (!parsed) {
        return res.status(400).json({ error: 'Invalid class code format, expected SUBJECT-NUMBER (e.g. CS-101)' })
      }

      const cls = await getDb().class.findUnique({
        where: { subject_number: { subject: parsed.subject, number: parsed.number } }
      })

      if (!cls) {
        return res.status(404).json({ error: 'Class not found' })
      }

      classId = cls.id
    }

    // Build offering filter
    const offeringWhere = {}
    if (classId !== null) offeringWhere.class_id = classId
    if (term !== '*') offeringWhere.term = term

    // Find matching offerings
    const offerings = await getDb().offering.findMany({ where: offeringWhere })
    if (offerings.length === 0) {
      return res.json({ data: [], total: 0, page, limit: take, totalPages: 0 })
    }

    const offeringIds = offerings.map(o => o.id)
    const where = { offering_id: { in: offeringIds } }

    // Fetch projects and count in parallel
    const [projects, agg] = await Promise.all([
      getDb().project.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'asc' }
      }),
      getDb().project.aggregate({ where, _count: { _all: true } })
    ])
    const total = agg._count._all

    const totalPages = Math.ceil(total / take) || 0

    res.json({ data: projects, total, page, limit: take, totalPages })
  } catch (err) {
    console.error('Error listing projects:', err)
    res.status(500).json({ error: 'Failed to list projects' })
  }
})

// Get details for a specific project (by id)
projectRouter.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid project ID' })
    }

    const project = await getDb().project.findUnique({
      where: { id },
      include: {
        offering: {
          include: {
            class: true,
            teacher: { select: { id: true, username: true, email: true } }
          }
        },
        assignments: {
          include: {
            student: { select: { id: true, username: true, email: true } }
          }
        }
      }
    })

    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    res.json(project)
  } catch (err) {
    console.error('Error retrieving project:', err)
    res.status(500).json({ error: 'Failed to retrieve project' })
  }
})

// Delete project route
projectRouter.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid project ID' })
    }

    // Check project exists
    const existing = await getDb().project.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ error: 'Project not found' })
    }

    // Delete associated assignments (cascade on project delete handles this,
    // but we do it explicitly for clarity and to satisfy the test expectation)
    await getDb().assignment.deleteMany({ where: { project_id: id } })

    await getDb().project.delete({ where: { id } })

    res.json({ message: 'Project deleted successfully' })
  } catch (err) {
    console.error('Error deleting project:', err)
    res.status(500).json({ error: 'Failed to delete project' })
  }
})

export default projectRouter
