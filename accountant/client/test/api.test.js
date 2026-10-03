import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchUsers,
  fetchUser,
  checkAvailability,
  createUser,
  updateUser,
  deleteUser,
  fetchOfferings,
  fetchOfferingTerms,
  createOffering,
  updateOffering,
  deleteOffering,
  fetchClasses,
  fetchTeachers,
  getToken,
  setToken,
  clearToken,
  getAuthHeaders,
  login,
  fetchCurrentUser
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

      expect(fetch).toHaveBeenCalledWith('/user/list/STUDENT?page=2&limit=10')
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

      expect(fetch).toHaveBeenCalledWith('/user/check/a%20b/x%40y.z')
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

      expect(fetch).toHaveBeenCalledWith('/user/9')
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

      expect(fetch).toHaveBeenCalledWith('/user/4', { method: 'DELETE' })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Cannot delete yourself' }, false))

      await expect(deleteUser(4)).rejects.toThrow('Cannot delete yourself')
    })
  })

  describe('fetchOfferings', () => {
    it('omits the term param for the wildcard and sends pagination', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 }))

      await fetchOfferings()

      expect(fetch).toHaveBeenCalledWith('/offering/list?page=1&limit=25')
    })

    it('sends term and section filters when provided', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ data: [], total: 0, page: 3, limit: 10, totalPages: 3 }))

      await fetchOfferings('FALL2025', 'B', 3, 10)

      expect(fetch).toHaveBeenCalledWith('/offering/list?term=FALL2025&section=B&page=3&limit=10')
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Failed to list offerings' }, false))

      await expect(fetchOfferings()).rejects.toThrow('Failed to list offerings')
    })
  })

  describe('fetchOfferingTerms', () => {
    it('returns the distinct terms from the API', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ terms: ['FALL2025', 'SPRING2026'] }))

      const terms = await fetchOfferingTerms()

      expect(fetch).toHaveBeenCalledWith('/offering/terms')
      expect(terms).toEqual(['FALL2025', 'SPRING2026'])
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

      await createOffering({ classId: 2, teacherId: 5, term: 'FALL2025', section: 'A' })

      expect(fetch).toHaveBeenCalledWith('/offering/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_id: 2, teacher_id: 5, term: 'FALL2025', section: 'A' })
      })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'An offering for this class already exists in this term and section' }, false))

      await expect(createOffering({ classId: 1, teacherId: 1, term: 'FALL2025', section: 'A' })).rejects.toThrow(/already exists/)
    })
  })

  describe('updateOffering', () => {
    it('only includes fields that are defined (partial update)', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ id: 1 }))

      await updateOffering(1, { section: 'B' })

      expect(fetch).toHaveBeenCalledWith('/offering/update/1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'B' })
      })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Another offering already exists for this class, term and section' }, false))

      await expect(updateOffering(1, { term: 'SPRING2026' })).rejects.toThrow(/already exists/)
    })
  })

  describe('deleteOffering', () => {
    it('sends a DELETE request for the offering id', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ message: 'Offering deleted successfully' }))

      await deleteOffering(7)

      expect(fetch).toHaveBeenCalledWith('/offering/7', { method: 'DELETE' })
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Failed to delete offering' }, false))

      await expect(deleteOffering(7)).rejects.toThrow('Failed to delete offering')
    })
  })

  describe('fetchClasses', () => {
    it('requests all classes with the wildcard filters', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }))

      await fetchClasses()

      expect(fetch).toHaveBeenCalledWith('/class/list/*/*?page=1&limit=100')
    })

    it('throws the server-provided error message on failure', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ error: 'Failed to list classes' }, false))

      await expect(fetchClasses()).rejects.toThrow('Failed to list classes')
    })
  })

  describe('fetchTeachers', () => {
    it('requests the TEACHER user list', async () => {
      fetch.mockResolvedValueOnce(jsonResponse({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }))

      await fetchTeachers()

      expect(fetch).toHaveBeenCalledWith('/user/list/TEACHER?page=1&limit=100')
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

      await expect(createOffering({ classId: 1, teacherId: 1, term: 'FALL2025', section: 'A' })).rejects.toThrow('Failed to create offering')
    })

    it('updateOffering falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(updateOffering(1, { term: 'SPRING2026' })).rejects.toThrow('Failed to update offering')
    })

    it('deleteOffering falls back to its default message', async () => {
      fetch.mockResolvedValueOnce(badJsonResponse())

      await expect(deleteOffering(1)).rejects.toThrow('Failed to delete offering')
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
