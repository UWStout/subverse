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
 * Strip sensitive fields from a user object before returning it.
 */
function sanitizeUser (user) {
  // eslint-disable-next-line camelcase
  const { password_hash, verification_token, reset_token, ...safe } = user
  return safe
}

/**
 * Query to check for username or email conflicts
 */
async function checkForConflicts(username, email) {
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
    const { username, email, password, type } = req.body

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
        type: userType
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

    const { username, email, password, type } = req.body

    // Validate that at least one field is provided
    if (!username && !email && !password && !type) {
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

    if (password !== undefined) {
      updateData.password_hash = await bcrypt.hash(password, 10)
    }

    if (type !== undefined) {
      const validTypes = ['STUDENT', 'TEACHER', 'ADMIN']
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `Invalid user type. Must be one of: ${validTypes.join(', ')}` })
      }
      updateData.type = type
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
userRouter.delete('/:id',  (req, res) => {
})

export default userRouter
