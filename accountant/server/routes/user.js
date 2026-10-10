/* eslint-disable camelcase */
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { Router, json } from 'express'
import { getDatabase } from '../db.js'
import { authenticate, requireVerified } from '../middleware/auth.js'
import { parseBulkEntries } from '../bulk-create.js'
import { generateVerificationToken, deliverVerificationEmail } from '../verification.js'
import { deliverSetPasswordEmail } from '../password-reset.js'
import { setUserPassword, removeUser, synchronizeRepositoryAccess, bestEffortSvn } from '../subversion.js'

// Fetch a project with the relations the SVN sync helpers need
// (assigned students + offering teacher usernames).
const SVN_SYNC_INCLUDE = {
  assignments: { include: { student: { select: { username: true } } } },
  offering: { include: { teacher: { select: { username: true } } } }
}

// Lazily resolve the database client on first request (avoids ESM init-order issues)
let db
function getDb () {
  if (!db) db = getDatabase()
  return db
}

const userRouter = new Router()

// Install Json body parser
userRouter.use(json())

// All user routes require a valid session token
userRouter.use(authenticate)

// ...and a verified (non-provisional) email address
userRouter.use(requireVerified)

/** Valid values for the User.type field (mirrors the Prisma UserType enum). */
const VALID_TYPES = ['STUDENT', 'TEACHER', 'ADMIN']

/**
 * Count how many ADMIN accounts exist. Used to protect the last remaining
 * admin from deletion or demotion.
 */
async function countAdmins () {
  return getDb().user.count({ where: { type: 'ADMIN' } })
}

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
    // Students have no access to user listing
    if (req.user.type === 'STUDENT') {
      return res.status(403).json({ error: 'Students cannot list users' })
    }

    const { type } = req.params

    const where = {}
    if (type && type !== '*') {
      // Accepts a single type or a comma-separated list, e.g. 'TEACHER,ADMIN'
      const types = type.split(',')
      if (!types.every(t => VALID_TYPES.includes(t))) {
        return res.status(400).json({ error: `Invalid user type. Must be one of: ${VALID_TYPES.join(', ')}` })
      }
      where.type = types.length === 1 ? types[0] : { in: types }
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

    // Students may only view their own account details (used to populate
    // the self-update form); teachers and admins may view any account
    if (req.user.type === 'STUDENT' && id !== req.user.sub) {
      return res.status(403).json({ error: 'Students can only view their own account' })
    }

    // Retrieve the user details by id, joined one level deep:
    //  - taught_offerings -> class (what this teacher teaches)
    //  - assignments -> project -> offering -> class (what this student works on)
    const user = await getDb().user.findUnique({
      where: { id },
      include: {
        taught_offerings: {
          include: {
            class: { select: { id: true, subject: true, number: true, title: true } }
          }
        },
        assignments: {
          include: {
            project: {
              select: {
                id: true,
                title: true,
                slug: true,
                offering: {
                  select: {
                    term: true,
                    section: true,
                    class: { select: { subject: true, number: true, title: true } }
                  }
                }
              }
            }
          }
        }
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

    // Role-based creation rules:
    //  - Students cannot create accounts at all
    //  - Teachers may only create STUDENT or TEACHER accounts (never ADMIN)
    if (req.user.type === 'STUDENT') {
      return res.status(403).json({ error: 'Students cannot create users' })
    }
    if (req.user.type === 'TEACHER' && type === 'ADMIN') {
      return res.status(403).json({ error: 'Teachers cannot create admin accounts' })
    }

    // Validate user type
    const userType = (type && VALID_TYPES.includes(type)) ? type : 'STUDENT'

    // Check for duplicate username or email
    const conflicts = await checkForConflicts(username, email)
    if (Array.isArray(conflicts) && conflicts.length > 0) {
      return res.status(409).json({ error: 'User info conflict', conflicts })
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 10)

    // New accounts are provisional until their email is verified: mint a token
    // and record the send time in the same write.
    const verificationToken = generateVerificationToken()

    // Create the user
    const user = await getDb().user.create({
      data: {
        username,
        email,
        password_hash: passwordHash,
        type: userType,
        first_name: first_name ?? null,
        last_name: last_name ?? null,
        verification_token: verificationToken,
        verification_sent_at: new Date()
      }
    })

    // Best-effort: the account stays provisional (locked out) if delivery fails.
    await deliverVerificationEmail(user, verificationToken)

    // Sync the new credentials into the SVN passwd file (same bcrypt hash as
    // the database row written above) so the account can authenticate against
    // the gateway as soon as it exists.
    await bestEffortSvn(`create user '${user.username}'`, () => setUserPassword(user.username, passwordHash))

    // Return the newly created user (with sensitive info removed)
    res.status(201).json({ user: sanitizeUser(user) })
  } catch (err) {
    console.error('Error creating user:', err)
    res.status(500).json({ error: 'Failed to create user' })
  }
})

// Route to create many users at once from a pasted "Name <email>" roster and
// assign every account to one project (issue #3). Existing accounts that
// match on BOTH username and email are reused as-is; unknown people get a
// password-less account plus an emailed link to set their first password.
// Conflicts (username or email matches, but not both) are reported per entry.
userRouter.post('/bulk-create', async (req, res) => {
  try {
    // Students cannot create accounts at all
    if (req.user.type === 'STUDENT') {
      return res.status(403).json({ error: 'Students cannot create users' })
    }

    const { project_id, entries } = req.body
    if (!project_id || typeof entries !== 'string' || !entries.trim()) {
      return res.status(400).json({ error: 'Missing required fields: project_id and entries (a pasted "Name <email>" list)' })
    }

    const projectId = parseInt(project_id, 10)
    if (isNaN(projectId)) {
      return res.status(400).json({ error: 'Invalid project ID' })
    }

    // Verify the project exists
    const project = await getDb().project.findUnique({ where: { id: projectId } })
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    // Teachers may only bulk-create for projects in offerings they teach
    if (req.user.type === 'TEACHER') {
      const offering = await getDb().offering.findUnique({ where: { id: project.offering_id } })
      if (!offering || offering.teacher_id !== req.user.sub) {
        return res.status(403).json({ error: 'Teachers can only add users to projects in classes they teach' })
      }
    }

    const parsed = parseBulkEntries(entries)
    if (parsed.entries.length === 0) {
      return res.status(400).json({ error: 'No valid entries found', details: parsed.errors })
    }

    // Process each entry independently so one bad row does not stop the rest.
    // Individual writes are small and idempotent, so a retried batch is safe.
    const results = []
    const errors = [...parsed.errors]
    let created = 0
    let assigned = 0
    let alreadyAssigned = 0
    const pendingEmails = []

    for (const entry of parsed.entries) {
      // Accounts claiming this username or email. To be reused, an account
      // must match on BOTH fields; anything less is a conflict. SQLite has no
      // case-insensitive filter in Prisma, so match with LOWER() in SQL.
      const matches = await getDb().$queryRaw`
        SELECT id, username, email FROM users
        WHERE LOWER(username) = LOWER(${entry.username})
           OR LOWER(email) = LOWER(${entry.email})
      `
      const byUsername = matches.find(u => u.username.toLowerCase() === entry.username.toLowerCase())
      const byEmail = matches.find(u => u.email.toLowerCase() === entry.email.toLowerCase())

      let user = null
      let isNew = false
      if (byUsername && byEmail) {
        if (byUsername.id === byEmail.id) {
          user = byUsername // full match - reuse the existing account
        } else {
          errors.push({
            index: entry.index,
            raw: entry.raw,
            reason: `Username '${entry.username}' belongs to ${byUsername.username} (${byUsername.email}) but email '${entry.email}' belongs to ${byEmail.username} (${byEmail.email})`
          })
        }
      } else if (byUsername || byEmail) {
        const clash = byUsername || byEmail
        const field = byUsername ? `Username '${entry.username}'` : `Email '${entry.email}'`
        errors.push({ index: entry.index, raw: entry.raw, reason: `${field} already belongs to ${clash.username} (${clash.email})` })
      }

      if (!user && !byUsername && !byEmail) {
        // No existing account: create one without a usable password (a hash
        // of a random secret, so no guess can ever log in) and queue the
        // set-password email. The account is not provisional - setting the
        // password via the emailed link is all that is required.
        const resetToken = generateVerificationToken()
        const placeholderHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10)
        user = await getDb().user.create({
          data: {
            username: entry.username,
            email: entry.email,
            password_hash: placeholderHash,
            type: 'STUDENT',
            first_name: entry.first_name,
            last_name: entry.last_name,
            reset_token: resetToken,
            reset_sent_at: new Date()
          }
        })
        isNew = true
        created++
        pendingEmails.push({ user, token: resetToken })
      }

      if (!user) continue // conflict - nothing to assign

      // Assign the account to the project (idempotent)
      const existingAssignment = await getDb().assignment.findUnique({
        where: { student_id_project_id: { student_id: user.id, project_id: projectId } }
      })
      if (existingAssignment) {
        alreadyAssigned++
        results.push({ index: entry.index, raw: entry.raw, status: 'already-assigned' })
      } else {
        await getDb().assignment.create({ data: { student_id: user.id, project_id: projectId } })
        if (isNew) {
          results.push({ index: entry.index, raw: entry.raw, status: 'created' })
        } else {
          assigned++
          results.push({ index: entry.index, raw: entry.raw, status: 'assigned' })
        }
      }
    }

    // Best-effort delivery of the set-password emails. A failed send leaves
    // the reset token in the database, so the account can recover through
    // the normal forgot-password flow.
    const emailFailures = []
    for (const { user, token } of pendingEmails) {
      const sent = await deliverSetPasswordEmail(user, token)
      if (!sent) emailFailures.push(user.email)
    }

    // Assignments changed: re-sync the project's SVN access so every new
    // member is in the group. (New accounts get their passwd entry later, when
    // they set their first password through the emailed link.)
    await bestEffortSvn(`bulk-create on project ${projectId}`, async () => {
      const full = await getDb().project.findUnique({ where: { id: projectId }, include: SVN_SYNC_INCLUDE })
      if (full) await synchronizeRepositoryAccess(full)
    })

    res.json({
      project_id: projectId,
      total: results.length + errors.length,
      created,
      assigned,
      already_assigned: alreadyAssigned,
      results,
      errors,
      email_failures: emailFailures
    })
  } catch (err) {
    console.error('Error bulk creating users:', err)
    res.status(500).json({ error: 'Failed to bulk create users' })
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

    // --- Role-based authorization for the update target ---
    //  - Students may only update their own account
    //  - Teachers may only update student accounts or their own account
    //  - Admins may update any account
    const isSelf = id === req.user.sub
    if (req.user.type === 'STUDENT' && !isSelf) {
      return res.status(403).json({ error: 'Students can only update their own account' })
    }
    if (req.user.type === 'TEACHER' && !isSelf && existingUser.type !== 'STUDENT') {
      return res.status(403).json({ error: 'Teachers can only update student accounts or their own account' })
    }

    // Only admins may change a user's type
    if (type !== undefined && req.user.type !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admins can change a user type' })
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
      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: `Invalid user type. Must be one of: ${VALID_TYPES.join(', ')}` })
      }
      // Never allow the last remaining admin account to be demoted
      if (existingUser.type === 'ADMIN' && type !== 'ADMIN') {
        const adminCount = await countAdmins()
        if (adminCount <= 1) {
          return res.status(403).json({ error: 'Cannot change the type of the last admin account' })
        }
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

    // A password change must reach the SVN passwd file (same bcrypt hash as
    // the database row updated above), otherwise the old credentials keep
    // working on the gateway.
    if (password) {
      await bestEffortSvn(`update user '${updatedUser.username}'`, () => setUserPassword(updatedUser.username, updateData.password_hash))
    }

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

    // Students cannot delete accounts at all
    if (req.user.type === 'STUDENT') {
      return res.status(403).json({ error: 'Students cannot delete users' })
    }

    // Check user exists
    const existing = await getDb().user.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Teachers may delete student or teacher accounts, but never admins
    if (req.user.type === 'TEACHER' && existing.type === 'ADMIN') {
      return res.status(403).json({ error: 'Teachers cannot delete admin accounts' })
    }

    // Never allow the last remaining admin account to be deleted
    if (existing.type === 'ADMIN') {
      const adminCount = await countAdmins()
      if (adminCount <= 1) {
        return res.status(403).json({ error: 'Cannot delete the last admin account' })
      }
    }

    // Remember which projects this student was on before the rows go away -
    // the SVN sync below needs them.
    const memberships = await getDb().assignment.findMany({
      where: { student_id: id },
      select: { project_id: true }
    })

    // Delete associated assignments (cascade on user delete handles this,
    // but we do it explicitly for clarity and to satisfy the test expectation)
    await getDb().assignment.deleteMany({ where: { student_id: id } })

    // Note: taught_offerings will be cascade-deleted by Prisma's onDelete: Cascade.
    // Those offerings' projects and their assignments are also cascaded.

    await getDb().user.delete({ where: { id } })

    // Revoke the account's SVN credentials (and drop it from any project
    // groups while we are at it).
    await bestEffortSvn(`delete user '${existing.username}'`, async () => {
      await removeUser(existing.username)
      for (const membership of memberships) {
        const full = await getDb().project.findUnique({ where: { id: membership.project_id }, include: SVN_SYNC_INCLUDE })
        if (full) await synchronizeRepositoryAccess(full)
      }
    })

    res.json({ message: 'User deleted successfully' })
  } catch (err) {
    console.error('Error deleting user:', err)
    res.status(500).json({ error: 'Failed to delete user' })
  }
})

export default userRouter
