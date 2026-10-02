import { Router, json } from 'express'
import { getDatabase } from '../db.js'

// Lazily resolve the database client on first request (avoids ESM init-order issues)
let db
function getDb () {
  if (!db) db = getDatabase()
  return db
}

const classRouter = new Router()

// Install Json body parser
classRouter.use(json())

/**
 * Strip nested sensitive data and return summarized class info.
 */
function summarizeClass (cls) {
  const { offerings, ...safe } = cls
  return {
    ...safe,
    offering_count: offerings?.length ?? 0
  }
}

// --- Routes (specific paths first, parameterized last) ---

// Get list of classes (filtered by term and/or teacher_id)
// - Return only summarized class data and limit number returned
classRouter.get('/list/:term/:teacher', async (req, res) => {
  try {
    const { term, teacher } = req.params

    // Build where clause for offerings filter
    const offeringFilter = {}
    if (term && term !== '*') offeringFilter.term = term
    if (teacher && teacher !== '*') offeringFilter.teacher_id = parseInt(teacher, 10)

    const limit = 50

    // If no filters, just return classes with a count of offerings
    if (!offeringFilter.term && !offeringFilter.teacher_id) {
      const classes = await getDb().class.findMany({
        take: limit,
        include: {
          _count: { select: { offerings: true } }
        },
        orderBy: { id: 'asc' }
      })

      return res.json(classes.map(summarizeClass))
    }

    // Filter through offerings to find matching classes
    const offerings = await getDb().offering.findMany({
      where: offeringFilter,
      include: { class: true },
      take: limit
    })

    const classes = offerings.map(o => o.class)
    const seen = new Set()
    const unique = classes.filter(c => {
      if (seen.has(c.id)) return false
      seen.add(c.id)
      return true
    })

    res.json(unique.map(summarizeClass))
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
    const { subject, number, title } = req.body

    // Validate required fields
    if (!subject || !number || !title) {
      return res.status(400).json({ error: 'Missing required fields: subject, number, title' })
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
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid class ID' })
    }

    const { subject, number, title } = req.body

    // Validate that at least one field is provided
    if (!subject && !number && !title) {
      return res.status(400).json({ error: 'No update fields provided' })
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
classRouter.delete('/:id',  (req, res) => {
})

export default classRouter
