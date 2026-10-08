import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchUsers,
  fetchUser,
  checkAvailability,
  createUser,
  bulkCreateUsers,
  updateUser,
  deleteUser,
  fetchOfferings,
  fetchOffering,
  fetchOfferingTerms,
  createOffering,
  updateOffering,
  deleteOffering,
  fetchProjects,
  fetchProject,
  createProject,
  updateProject,
  deleteProject,
  createClass,
  fetchClasses,
  fetchTeachers,
  getToken,
  setToken,
  clearToken,
  getAuthHeaders,
  login,
  fetchCurrentUser,
  isEmailVerified,
  verifyEmail,
  resendVerification,
  requestPasswordReset,
  resetPassword,
  fetchBootstrapStatus,
  createBootstrapAccount
} from '../src/services/api'

/** Build a minimal Response-like object for the mocked fetch. */
function jsonResponse (body, ok = true) {
  return { ok, json: () => Promise.resolve(body) }
}

/** Failed response whose body is not valid JSON (e.g. an HTML error page). */
function badJsonResponse () {
  return { ok: false, json: () => Promise.reject(new Error('Unexpected content type')) }
}

describe('services/api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })

  describe('fetchUsers', () => {
    it('requests the paginated list endpoint and returns parsed data', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ data: [{ id: 1 }], total: 1, page: 2, limit: 10, totalPages: 1 }))

      const res = await fetchUsers('STUDENT', 2, 10)

      expect(fetch).toHaveBeenCalledWith('/user/list/STUDENT?page=2&limit=10', { headers: {} })
      expect(res.total).toBe(1)
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'No users found' }, false))

      await expect(fetchUsers()).rejects.toThrow('No users found')
    })
  })

  describe('checkAvailability', () => {
    it('URL-encodes username and email in the path', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ available: true }))

      await checkAvailability('a b', 'x@y.z')

      expect(fetch).toHaveBeenCalledWith('/user/check/a%20b/x%40y.z', { headers: {} })
    })
  })

  describe('token helpers', () => {
    it('stores, reads and clears the session token', () => {
      expect(getToken()).toBeNull()

      setToken('tok123')
      expect(getToken()).toBe('tok123')

      clearToken()
      expect(getToken()).toBeNull()
    })

    it('builds auth headers from the stored token', () => {
      expect(getAuthHeaders()).toEqual({})

      setToken('tok123')
      expect(getAuthHeaders()).toEqual({ Authorization: 'Bearer tok123' })
    })
  })

  describe('auth headers on protected endpoints', () => {
    it('sends the stored token as a Bearer header on GET requests', async () => {
      setToken('tok123')
      fetch.mockResolvedValueOnce(jsonResponse({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 }))

      await fetchUsers()

      expect(fetch).toHaveBeenCalledWith('/user/list/*?page=1&limit=25', {
        headers: { Authorization: 'Bearer tok123' }
      })
    })

    it('merges the Bearer header with Content-Type on POST requests', async () => {
      setToken('tok123')
      fetch.mockResolvedValueOnce(jsonResponse({ user: { id: 10 } }))

      await createUser({ username: 'a', email: 'b@c.d', password: 'p', type: 'STUDENT' })

      expect(fetch).toHaveBeenCalledWith('/user/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok123' },
        body: JSON.stringify({ username: 'a', email: 'b@c.d', password: 'p', type: 'STUDENT' })
      })
    })

    it('sends the Bearer header on DELETE requests', async () => {
      setToken('tok123')
      fetch.mockResolvedValueOnce(jsonResponse({ message: 'User deleted successfully' }))

      await deleteUser(4)

      expect(fetch).toHaveBeenCalledWith('/user/4', { method: 'DELETE', headers: { Authorization: 'Bearer tok123' } })
    })

    it('clears the stored token when a protected endpoint returns 401', async () => {
      setToken('stale')
      fetch.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Invalid or expired token' }) })

      await expect(fetchUser(9)).rejects.toThrow('Invalid or expired token')
      expect(getToken()).toBeNull()
    })
  })

  describe('login', () => {
    it('posts credentials, stores the token and returns the user', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ token: 'tok456', user: { id: 7, username: 'testuser' } }))

      const user = await login('testuser', 'secret')

      expect(fetch).toHaveBeenCalledWith('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', password: 'secret' })
      })
      expect(user.username).toBe('testuser')
      expect(getToken()).toBe('tok456')
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Invalid credentials' }, false))

      await expect(login('u', 'p')).rejects.toThrow('Invalid credentials')
      expect(getToken()).toBeNull()
    })
  })

  describe('fetchUser', () => {
    it('requests the user by id and returns parsed data', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ id: 9, username: 'alice' }))

      const res = await fetchUser(9)

      expect(fetch).toHaveBeenCalledWith('/user/9', { headers: {} })
      expect(res.username).toBe('alice')
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'User not found' }, false))

      await expect(fetchUser(9)).rejects.toThrow('User not found')
    })
  })

  describe('createUser', () => {
    it('posts the payload with snake_case name fields', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ user: { id: 10 } }))

      await createUser({ username: 'newuser', email: 'n@x.com', password: 'secret', type: 'STUDENT', firstName: 'New', lastName: 'User' })

      expect(fetch).toHaveBeenCalledWith('/user/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'newuser', email: 'n@x.com', password: 'secret', type: 'STUDENT', first_name: 'New', last_name: 'User' })
      })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Username already in use' }, false))

      await expect(createUser({ username: 'a', email: 'b@c.d', password: 'p', type: 'STUDENT' })).rejects.toThrow('Username already in use')
    })
  })

  describe('bulkCreateUsers', () => {
    it('posts the project id and raw roster text to /user/bulk-create', async () => {
      setToken('tok123')
      const summary = { total: 2, created: 1, assigned: 1, already_assigned: 0, results: [], errors: [], email_failures: [] }
      fetch.mockResolvedValueOnce(jsonResponse(summary))

      const res = await bulkCreateUsers(4, 'Doe, John <jdoe@x.edu>\nSmith, Jane <jsmith@x.edu>')

      expect(fetch).toHaveBeenCalledWith('/user/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok123' },
        body: JSON.stringify({ project_id: 4, entries: 'Doe, John <jdoe@x.edu>\nSmith, Jane <jsmith@x.edu>' })
      })
      expect(res).toEqual(summary)
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'No valid entries found' }, false))

      await expect(bulkCreateUsers(4, 'garbage')).rejects.toThrow('No valid entries found')
    })

    it('falls back to a default message when the error body is not JSON', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(bulkCreateUsers(4, 'garbage')).rejects.toThrow('Failed to bulk create users')
    })
  })

  describe('updateUser', () => {
    it('posts the payload to /user/update/:id with snake_case name fields', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ user: { id: 10 } }))

      await updateUser(10, { username: 'newuser', email: 'n@x.com', password: '', type: 'TEACHER', firstName: 'New', lastName: 'User' })

      expect(fetch).toHaveBeenCalledWith('/user/update/10', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'newuser', email: 'n@x.com', password: '', type: 'TEACHER', first_name: 'New', last_name: 'User' })
      })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Email already in use' }, false))

      await expect(updateUser(10, {})).rejects.toThrow('Email already in use')
    })
  })

  describe('deleteUser', () => {
    it('sends a DELETE request for the user id', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ message: 'User deleted successfully' }))

      await deleteUser(4)

      expect(fetch).toHaveBeenCalledWith('/user/4', { method: 'DELETE', headers: {} })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Cannot delete yourself' }, false))

      await expect(deleteUser(4)).rejects.toThrow('Cannot delete yourself')
    })
  })

  describe('fetchOfferings', () => {
    it('sends all wildcard positions and pagination by default', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 }))

      await fetchOfferings()

      expect(fetch).toHaveBeenCalledWith('/offering/list/*/*/*?page=1&limit=25', { headers: {} })
    })

    it('sends term, class_id and teacher_id as URL positions when provided', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ data: [], total: 0, page: 3, limit: 10, totalPages: 3 }))

      await fetchOfferings('FALL25', 1, 2, 3, 10)

      expect(fetch).toHaveBeenCalledWith('/offering/list/FALL25/1/2?page=3&limit=10', { headers: {} })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Failed to list offerings' }, false))

      await expect(fetchOfferings()).rejects.toThrow('Failed to list offerings')
    })
  })

  describe('fetchOffering', () => {
    it('requests the offering by id and returns parsed data', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ id: 3, term: 'FALL25', projects: [] }))

      const res = await fetchOffering(3)

      expect(fetch).toHaveBeenCalledWith('/offering/3', { headers: {} })
      expect(res.term).toBe('FALL25')
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Offering not found' }, false))

      await expect(fetchOffering(3)).rejects.toThrow('Offering not found')
    })
  })

  describe('fetchOfferingTerms', () => {
    it('returns the distinct terms from the API', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ terms: ['FALL25', 'SPRING26'] }))

      const terms = await fetchOfferingTerms()

      expect(fetch).toHaveBeenCalledWith('/offering/terms', { headers: {} })
      expect(terms).toEqual(['FALL25', 'SPRING26'])
    })

    it('falls back to an empty list when the response has no terms', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({}))

      await expect(fetchOfferingTerms()).resolves.toEqual([])
    })

    it('throws on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({}, false))

      await expect(fetchOfferingTerms()).rejects.toThrow('Failed to list offering terms')
    })
  })

  describe('createOffering', () => {
    it('posts the payload with snake_case id fields', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ id: 1 }))

      await createOffering({ classId: 2, teacherId: 5, term: 'FALL25', section: '101' })

      expect(fetch).toHaveBeenCalledWith('/offering/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_id: 2, teacher_id: 5, term: 'FALL25', section: '101' })
      })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'An offering for this class already exists in this term and section' }, false))

      await expect(createOffering({ classId: 1, teacherId: 1, term: 'FALL25', section: '101' })).rejects.toThrow(/already exists/)
    })
  })

  describe('updateOffering', () => {
    it('only includes fields that are defined (partial update)', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ id: 1 }))

      await updateOffering(1, { section: '102' })

      expect(fetch).toHaveBeenCalledWith('/offering/update/1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: '102' })
      })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Another offering already exists for this class, term and section' }, false))

      await expect(updateOffering(1, { term: 'SPRING26' })).rejects.toThrow(/already exists/)
    })
  })

  describe('deleteOffering', () => {
    it('sends a DELETE request for the offering id', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ message: 'Offering deleted successfully' }))

      await deleteOffering(7)

      expect(fetch).toHaveBeenCalledWith('/offering/7', { method: 'DELETE', headers: {} })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Failed to delete offering' }, false))

      await expect(deleteOffering(7)).rejects.toThrow('Failed to delete offering')
    })
  })

  describe('fetchProjects', () => {
    it('sends wildcard positions and pagination by default', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 }))

      await fetchProjects()

      expect(fetch).toHaveBeenCalledWith('/project/list/*/*?page=1&limit=25', { headers: {} })
    })

    it('sends the class code and term as URL positions when provided', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ data: [], total: 0, page: 3, limit: 10, totalPages: 3 }))

      await fetchProjects('CS-101', 'FALL25', 3, 10)

      expect(fetch).toHaveBeenCalledWith('/project/list/CS-101/FALL25?page=3&limit=10', { headers: {} })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'At least one filter (class or term) is required' }, false))

      await expect(fetchProjects()).rejects.toThrow(/at least one/i)
    })
  })

  describe('fetchProject', () => {
    it('requests the project by id and returns parsed data', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ id: 7, title: 'Realm of Echoes' }))

      const res = await fetchProject(7)

      expect(fetch).toHaveBeenCalledWith('/project/7', { headers: {} })
      expect(res.title).toBe('Realm of Echoes')
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Project not found' }, false))

      await expect(fetchProject(7)).rejects.toThrow('Project not found')
    })
  })

  describe('createProject', () => {
    it('posts the payload with snake_case fields', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ id: 1 }))

      await createProject({ offeringId: 2, title: 'Final Project', slug: 'final-project', subversionUrl: null, gitUrl: 'https://git.example.com/x.git', description: 'Do it' })

      expect(fetch).toHaveBeenCalledWith('/project/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offering_id: 2, title: 'Final Project', slug: 'final-project', subversion_url: null, git_url: 'https://git.example.com/x.git', description: 'Do it' })
      })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Invalid slug format, expected lowercase letters and numbers separated by single hyphens (e.g. final-project)' }, false))

      await expect(createProject({ offeringId: 1, title: 'x', slug: 'Bad Slug' })).rejects.toThrow(/invalid slug/i)
    })
  })

  describe('updateProject', () => {
    it('only includes fields that are defined (partial update)', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ id: 1 }))

      await updateProject(1, { title: 'Renamed' })

      expect(fetch).toHaveBeenCalledWith('/project/update/1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed' })
      })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Teachers can only update projects in classes they teach' }, false))

      await expect(updateProject(1, { title: 'x' })).rejects.toThrow(/only update projects/i)
    })
  })

  describe('deleteProject', () => {
    it('sends a DELETE request for the project id', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ message: 'Project deleted successfully' }))

      await deleteProject(7)

      expect(fetch).toHaveBeenCalledWith('/project/7', { method: 'DELETE', headers: {} })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Failed to delete project' }, false))

      await expect(deleteProject(7)).rejects.toThrow('Failed to delete project')
    })
  })

  describe('createClass', () => {
    it('posts the class fields and returns the created class', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ id: 10, subject: 'PHYS', number: '150', title: 'Physics I' }))

      const result = await createClass({ subject: 'PHYS', number: '150', title: 'Physics I' })

      expect(fetch).toHaveBeenCalledWith('/class/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: 'PHYS', number: '150', title: 'Physics I' })
      })
      expect(result.id).toBe(10)
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Class already exists with this subject and number' }, false))

      await expect(createClass({ subject: 'CS', number: '101', title: 'x' })).rejects.toThrow('Class already exists with this subject and number')
    })
  })

  describe('fetchClasses', () => {
    it('requests all classes (no filters)', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }))

      await fetchClasses()

      expect(fetch).toHaveBeenCalledWith('/class/list/*/*?page=1&limit=100', { headers: {} })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Failed to list classes' }, false))

      await expect(fetchClasses()).rejects.toThrow('Failed to list classes')
    })
  })

  describe('fetchTeachers', () => {
    it('requests the teacher and admin user lists', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }))

      await fetchTeachers()

      expect(fetch).toHaveBeenCalledWith('/user/list/TEACHER,ADMIN?page=1&limit=100', { headers: {} })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Failed to list teachers' }, false))

      await expect(fetchTeachers()).rejects.toThrow('Failed to list teachers')
    })
  })

  describe('fetchCurrentUser', () => {
    it('sends the stored token and returns the user', async () => {
      setToken('tok789')
      fetch.mockResolvedValueOnce(jsonResponse({ id: 1, username: 'alice' }))

      const res = await fetchCurrentUser()

      expect(fetch).toHaveBeenCalledWith('/auth/me', { headers: { Authorization: 'Bearer tok789' } })
      expect(res.username).toBe('alice')
    })

    it('clears the token and throws when the session is invalid', async () => {
      setToken('stale')
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Invalid token' }, false))

      await expect(fetchCurrentUser()).rejects.toThrow('Not logged in')
      expect(getToken()).toBeNull()
    })
  })

  describe('isEmailVerified', () => {
    it('treats a null verification_sent_at as verified', () => {
      expect(isEmailVerified({ id: 1, username: 'alice', verification_sent_at: null })).toBe(true)
    })

    it('treats a pending verification_sent_at as unverified', () => {
      expect(isEmailVerified({ id: 1, username: 'alice', verification_sent_at: '2026-10-07T00:00:00Z' })).toBe(false)
    })

    it('treats a missing user as unverified', () => {
      expect(isEmailVerified(null)).toBe(false)
    })
  })

  describe('verifyEmail', () => {
    it('posts the token without an auth header (public endpoint)', async () => {
      setToken('tok123') // a stored session token must NOT be sent - verify-email is public
      fetch.mockResolvedValueOnce(jsonResponse({ message: 'Email address verified successfully' }))

      const res = await verifyEmail('abc123')

      expect(fetch).toHaveBeenCalledWith('/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'abc123' })
      })
      expect(res.message).toBe('Email address verified successfully')
    })

    it('throws the server error for an invalid token (400)', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Invalid verification token' }, false))

      await expect(verifyEmail('bad')).rejects.toThrow('Invalid verification token')
    })

    it('throws the server error for an expired token (410)', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Verification token has expired. Request a new one.' }, false))

      await expect(verifyEmail('old')).rejects.toThrow(/expired/)
    })

    it('falls back to its default message when the body is not valid JSON', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(verifyEmail('x')).rejects.toThrow('Failed to verify email address')
    })
  })

  describe('resendVerification', () => {
    it('posts the stored token as a Bearer header (authenticated endpoint)', async () => {
      setToken('tok123')
      fetch.mockResolvedValueOnce(jsonResponse({ message: 'Verification email sent' }))

      await resendVerification()

      expect(fetch).toHaveBeenCalledWith('/auth/resend-verification', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok123' }
      })
    })

    it('throws the server error when delivery fails (502)', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Failed to send verification email. Try again later.' }, false))

      await expect(resendVerification()).rejects.toThrow(/try again later/i)
    })

    it('throws the server error when the address is already verified', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Email address already verified' }, false))

      await expect(resendVerification()).rejects.toThrow('Email address already verified')
    })
  })

  describe('requestPasswordReset', () => {
    it('posts the identifier without an auth header (public endpoint)', async () => {
      setToken('tok123') // a stored session token must NOT be sent - forgot-password is public
      fetch.mockResolvedValueOnce(jsonResponse({ message: 'If an account matches that username or email, a password reset link has been sent' }))

      const res = await requestPasswordReset('alice@example.com')

      expect(fetch).toHaveBeenCalledWith('/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'alice@example.com' })
      })
      expect(res.message).toMatch(/password reset link has been sent/i)
    })

    it('throws the server error on failure (500)', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Failed to process password reset request' }, false))

      await expect(requestPasswordReset('alice')).rejects.toThrow(/failed to process/i)
    })

    it('falls back to its default message when the body is not valid JSON', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(requestPasswordReset('alice')).rejects.toThrow('Failed to request password reset')
    })
  })

  describe('resetPassword', () => {
    it('posts the token and new password without an auth header (public endpoint)', async () => {
      setToken('tok123') // a stored session token must NOT be sent - reset-password is public
      fetch.mockResolvedValueOnce(jsonResponse({ message: 'Password has been reset successfully' }))

      const res = await resetPassword('abc123', 'new-secret-1')

      expect(fetch).toHaveBeenCalledWith('/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'abc123', password: 'new-secret-1' })
      })
      expect(res.message).toBe('Password has been reset successfully')
    })

    it('throws the server error for an invalid token (400)', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Invalid reset token' }, false))

      await expect(resetPassword('bad', 'new-secret-1')).rejects.toThrow('Invalid reset token')
    })

    it('throws the server error for an expired token (410)', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Reset token has expired. Request a new one.' }, false))

      await expect(resetPassword('old', 'new-secret-1')).rejects.toThrow(/expired/)
    })

    it('falls back to its default message when the body is not valid JSON', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(resetPassword('x', 'y')).rejects.toThrow('Failed to reset password')
    })
  })

  describe('fetchBootstrapStatus', () => {
    it('returns true when the server is in bootstrap mode', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ bootstrap: true }))

      const res = await fetchBootstrapStatus()

      expect(fetch).toHaveBeenCalledWith('/auth/bootstrap/status')
      expect(res).toBe(true)
    })

    it('returns false when accounts already exist', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ bootstrap: false }))

      const res = await fetchBootstrapStatus()

      expect(res).toBe(false)
    })

    it('throws on a non-OK response', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, false))

      await expect(fetchBootstrapStatus()).rejects.toThrow('Failed to check bootstrap status')
    })
  })

  describe('createBootstrapAccount', () => {
    it('posts the account details and token without an auth header', async () => {
      setToken('tok123') // a stored session token must NOT be sent - bootstrap is public
      fetch.mockResolvedValueOnce(jsonResponse({ message: 'ok', user: { id: 1, type: 'ADMIN' } }))

      const res = await createBootstrapAccount({
        token: 'bootstrap-token',
        username: 'rootadmin',
        email: 'root@example.com',
        password: 'sup3r-secret',
        firstName: 'Root',
        lastName: 'Admin'
      })

      expect(fetch).toHaveBeenCalledWith('/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'bootstrap-token',
          username: 'rootadmin',
          email: 'root@example.com',
          password: 'sup3r-secret',
          first_name: 'Root',
          last_name: 'Admin'
        })
      })
      expect(res.user.type).toBe('ADMIN')
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Bootstrap token has expired' }, false))

      await expect(createBootstrapAccount({ token: 'x', username: 'a', email: 'b@c.d', password: 'p' })).rejects.toThrow('Bootstrap token has expired')
    })
  })

  describe('error bodies that are not valid JSON', () => {
    // Each helper falls back to a default message when res.json() rejects.

    it('fetchUsers falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(fetchUsers()).rejects.toThrow('Failed to list users')
    })

    it('fetchUser falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(fetchUser(1)).rejects.toThrow('Failed to fetch user')
    })

    it('createUser falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(createUser({ username: 'a', email: 'b@c.d', password: 'p', type: 'STUDENT' })).rejects.toThrow('Failed to create user')
    })

    it('updateUser falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(updateUser(1, {})).rejects.toThrow('Failed to update user')
    })

    it('deleteUser falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(deleteUser(1)).rejects.toThrow('Failed to delete user')
    })

    it('fetchOfferings falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(fetchOfferings()).rejects.toThrow('Failed to list offerings')
    })

    it('createOffering falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(createOffering({ classId: 1, teacherId: 1, term: 'FALL25', section: '101' })).rejects.toThrow('Failed to create offering')
    })

    it('updateOffering falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(updateOffering(1, { term: 'SPRING26' })).rejects.toThrow('Failed to update offering')
    })

    it('deleteOffering falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(deleteOffering(1)).rejects.toThrow('Failed to delete offering')
    })

    it('fetchProjects falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(fetchProjects()).rejects.toThrow('Failed to list projects')
    })

    it('createProject falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(createProject({ offeringId: 1, title: 'x', slug: 'x' })).rejects.toThrow('Failed to create project')
    })

    it('updateProject falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(updateProject(1, { title: 'x' })).rejects.toThrow('Failed to update project')
    })

    it('deleteProject falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(deleteProject(1)).rejects.toThrow('Failed to delete project')
    })

    it('fetchClasses falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(fetchClasses()).rejects.toThrow('Failed to list classes')
    })

    it('fetchTeachers falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(fetchTeachers()).rejects.toThrow('Failed to list teachers')
    })

    it('login falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(login('u', 'p')).rejects.toThrow('Login failed')
    })
  })
})
