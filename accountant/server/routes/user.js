/* eslint-disable camelcase */
import bcrypt from 'bcryptjs'
import { Router, json } from 'express'
import { getDatabase } from '../db.js'

// Lazily resolve the database client on first request (avoids ESM init-order issues)
let db
function getDb () {
  if (!db) db = getDatabase()
  return db
}

const userRouter = new Router()

// Install Json body parser
userRouter.use(json())

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
 * Strip sensitive fields from a user object before returning it.
 */
function sanitizeUser (user) {
  const { password_hash, verification_token, reset_token, ...safe } = user
  return safe
}

/**
 * Query to check for username or email conflicts
 */
async function checkForConflicts (username, email) {
  // Check for duplicate username or email
  const existingUser = await getDb().user.findFirst({
    where: {
      OR: [
        { username },
        { email }
      ]
    },
    select: { username: true, email: true }
  })

  if (existingUser) {
    const conflicts = []
    if (existingUser.username === username) conflicts.push('username')
    if (existingUser.email === email) conflicts.push('email')
    return conflicts
  }

  // No conflicts
  return []
}

// --- Routes (specific paths first, parameterized last) ---

// Get list of users (optionally filtered by type, with pagination)
userRouter.get('/list/:type', async (req, res) => {
  try {
    const { type } = req.params

    const where = {}
    if (type && type !== '*') {
      const validTypes = ['STUDENT', 'TEACHER', 'ADMIN']
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `Invalid user type. Must be one of: ${validTypes.join(', ')}` })
      }
      where.type = type
    }

    const { skip, take, page } = parsePagination(req.query)

    // Fetch the page slice and total count in parallel
    const [users, agg] = await Promise.all([
      getDb().user.findMany({ where, skip, take, orderBy: { id: 'asc' } }),
      getDb().user.aggregate({ where, _count: { _all: true } })
    ])
    const total = agg._count._all

    res.json({
      data: users.map(sanitizeUser),
      total,
      page,
      limit: take,
      totalPages: Math.ceil(total / take) || 1
    })
  } catch (err) {
    console.error('Error listing users:', err)
    res.status(500).json({ error: 'Failed to list users' })
  }
})

// Route to check if the username and/or email are already in use
userRouter.get('/check/:username/:email', async (req, res) => {
  try {
    // Read the parameters from the URL
    const { username, email } = req.params

    // Query the database to check these properties
    const conflicts = await checkForConflicts(username, email)

    // All is good, return positive response
    if (Array.isArray(conflicts) && conflicts.length === 0) {
      return res.json({ available: true })
    }

    res.json({ available: false, conflicts })
  } catch (err) {
    console.error('Error checking user availability:', err)
    res.status(500).json({ error: 'Failed to check availability' })
  }
})

// Route to retrieve details for a single user
userRouter.get('/:id', async (req, res) => {
  try {
    // Parse ID into an integer
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid user ID' })
    }

    // Retrieve the user details by id
    const user = await getDb().user.findUnique({
      where: { id },
      include: {
        taught_offerings: true,
        assignments: true
      }
    })

    // Was a user found
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Return the user with sensitive info stripped out
    res.json(sanitizeUser(user))
  } catch (err) {
    console.error('Error retrieving user:', err)
    res.status(500).json({ error: 'Failed to retrieve user' })
  }
})

// Route to create a new user
userRouter.post('/create', async (req, res) => {
  try {
    // Read out required fields
    const { username, email, password, type, first_name, last_name } = req.body

    // Validate required fields
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields: username, email, password' })
    }

    // Validate user type
    const validTypes = ['STUDENT', 'TEACHER', 'ADMIN']
    const userType = (type && validTypes.includes(type)) ? type : 'STUDENT'

    // Check for duplicate username or email
    const conflicts = await checkForConflicts(username, email)
    if (Array.isArray(conflicts) && conflicts.length > 0) {
      return res.status(409).json({ error: 'User info conflict', conflicts })
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 10)

    // Create the user
    const user = await getDb().user.create({
      data: {
        username,
        email,
        password_hash: passwordHash,
        type: userType,
        first_name: first_name ?? null,
        last_name: last_name ?? null
      }
    })

    // Return the newly created user (with sensitive info removed)
    res.status(201).json({ user: sanitizeUser(user) })
  } catch (err) {
    console.error('Error creating user:', err)
    res.status(500).json({ error: 'Failed to create user' })
  }
})

// Route to update an existing user
userRouter.post('/update/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid user ID' })
    }

    const { username, email, password, type, first_name, last_name } = req.body

    // Validate that at least one field is provided
    if (!username && !email && !password && !type && first_name === undefined && last_name === undefined) {
      return res.status(400).json({ error: 'No update fields provided' })
    }

    const prisma = getDb()

    // Check user exists
    const existingUser = await prisma.user.findUnique({ where: { id } })
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Build update data
    const updateData = {}

    if (username !== undefined) {
      // Check username uniqueness
      const duplicate = await prisma.user.findFirst({
        where: { username, id: { not: id } }
      })
      if (duplicate) {
        return res.status(409).json({ error: 'Username already in use' })
      }
      updateData.username = username
    }

    if (email !== undefined) {
      // Check email uniqueness
      const duplicate = await prisma.user.findFirst({
        where: { email, id: { not: id } }
      })
      if (duplicate) {
        return res.status(409).json({ error: 'Email already in use' })
      }
      updateData.email = email
    }

    // Only change the password when a non-empty value is provided;
    // omitted or blank means "keep the current password"
    if (password) {
      updateData.password_hash = await bcrypt.hash(password, 10)
    }

    if (type !== undefined) {
      const validTypes = ['STUDENT', 'TEACHER', 'ADMIN']
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `Invalid user type. Must be one of: ${validTypes.join(', ')}` })
      }
      updateData.type = type
    }

    if (first_name !== undefined) {
      updateData.first_name = first_name || null
    }

    if (last_name !== undefined) {
      updateData.last_name = last_name || null
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData
    })

    res.json({ user: sanitizeUser(updatedUser) })
  } catch (err) {
    console.error('Error updating user:', err)
    res.status(500).json({ error: 'Failed to update user' })
  }
})

// Delete user route
userRouter.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid user ID' })
    }

    // Check user exists
    const existing = await getDb().user.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Delete associated assignments (cascade on user delete handles this,
    // but we do it explicitly for clarity and to satisfy the test expectation)
    await getDb().assignment.deleteMany({ where: { student_id: id } })

    // Note: taught_offerings will be cascade-deleted by Prisma's onDelete: Cascade.
    // Those offerings' projects and their assignments are also cascaded.

    await getDb().user.delete({ where: { id } })

    res.json({ message: 'User deleted successfully' })
  } catch (err) {
    console.error('Error deleting user:', err)
    res.status(500).json({ error: 'Failed to delete user' })
  }
})

export default userRouter
