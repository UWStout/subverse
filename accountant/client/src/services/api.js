/**
 * API client helpers for the Accountant REST API.
 *
 * In development Vite proxies /user, /class, /project → http://localhost:3000
 * In production Express serves both static files and API routes directly.
 */

const BASE = '' // no prefix – routes are proxied / forwarded as-is

/* ------------------------------------------------------------------ */
/*  Users                                                              */
/* ------------------------------------------------------------------ */

/**
 * GET /user/list/:type  (type = 'STUDENT' | 'TEACHER' | 'ADMIN' | '*')
 * Query params: ?page=N&limit=N  (defaults: page=1, limit=25)
 * Returns { data, total, page, limit, totalPages }
 */
export async function fetchUsers (type = '*', page = 1, limit = 25) {
  const res = await fetch(`${BASE}/user/list/${type}?page=${page}&limit=${limit}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to list users' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/** GET /user/:id */
export async function fetchUser (id) {
  const res = await fetch(`${BASE}/user/${id}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to fetch user' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/** GET /user/check/:username/:email */
export async function checkAvailability (username, email) {
  const res = await fetch(`${BASE}/user/check/${encodeURIComponent(username)}/${encodeURIComponent(email)}`)
  if (!res.ok) throw new Error('Failed to check availability')
  return res.json()
}

/** POST /user/create */
export async function createUser ({ username, email, password, type, firstName, lastName }) {
  const res = await fetch(`${BASE}/user/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password, type, first_name: firstName, last_name: lastName })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to create user' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json() // { user: ... }
}

/** POST /user/update/:id */
export async function updateUser (id, { username, email, password, type, firstName, lastName }) {
  const res = await fetch(`${BASE}/user/update/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password, type, first_name: firstName, last_name: lastName })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to update user' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json() // { user: ... }
}

/** DELETE /user/:id */
export async function deleteUser (id) {
  const res = await fetch(`${BASE}/user/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to delete user' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/* ------------------------------------------------------------------ */
/*  Offerings                                                          */
/* ------------------------------------------------------------------ */

/**
 * GET /offering/list  (query: ?term=&section=&page=N&limit=N)
 * Defaults: term='*' (no filter), page=1, limit=25.
 * Returns { data, total, page, limit, totalPages } where each offering
 * includes its class and teacher details.
 */
export async function fetchOfferings (term = '*', section = '', page = 1, limit = 25) {
  const query = new URLSearchParams()
  if (term && term !== '*') query.set('term', term)
  if (section) query.set('section', section)
  query.set('page', String(page))
  query.set('limit', String(limit))

  const res = await fetch(`${BASE}/offering/list?${query.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to list offerings' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/** GET /offering/terms — distinct term values for filter chips. */
export async function fetchOfferingTerms () {
  const res = await fetch(`${BASE}/offering/terms`)
  if (!res.ok) throw new Error('Failed to list offering terms')
  const data = await res.json()
  return data.terms || []
}

/** POST /offering/create */
export async function createOffering ({ classId, teacherId, term, section }) {
  const res = await fetch(`${BASE}/offering/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ class_id: classId, teacher_id: teacherId, term, section })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to create offering' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json() // the created offering
}

/** POST /offering/update/:id */
export async function updateOffering (id, { classId, teacherId, term, section }) {
  const payload = {}
  if (classId !== undefined) payload.class_id = classId
  if (teacherId !== undefined) payload.teacher_id = teacherId
  if (term !== undefined) payload.term = term
  if (section !== undefined) payload.section = section

  const res = await fetch(`${BASE}/offering/update/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to update offering' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json() // the updated offering
}

/** DELETE /offering/:id */
export async function deleteOffering (id) {
  const res = await fetch(`${BASE}/offering/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to delete offering' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/* ------------------------------------------------------------------ */
/*  Classes & Teachers (option lists for the offering form)            */
/* ------------------------------------------------------------------ */

/**
 * GET /class/list/-*-/-*- — all classes (no filters), used to populate the
 * class selector in the offering form.
 * Returns { data, total, page, limit, totalPages }
 */
export async function fetchClasses (page = 1, limit = 100) {
  const res = await fetch(`${BASE}/class/list/*/*?page=${page}&limit=${limit}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to list classes' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/**
 * GET /user/list/TEACHER — all teacher accounts, used to populate the
 * teacher selector in the offering form.
 * Returns { data, total, page, limit, totalPages }
 */
export async function fetchTeachers (page = 1, limit = 100) {
  const res = await fetch(`${BASE}/user/list/TEACHER?page=${page}&limit=${limit}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to list teachers' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/* ------------------------------------------------------------------ */
/*  Auth                                                               */
/* ------------------------------------------------------------------ */

const TOKEN_KEY = 'accountant_token'

/** Get the stored session token (or null when not logged in). */
export function getToken () {
  return localStorage.getItem(TOKEN_KEY)
}

/** Store the session token after a successful login. */
export function setToken (token) {
  localStorage.setItem(TOKEN_KEY, token)
}

/** Clear the stored token (logout). */
export function clearToken () {
  localStorage.removeItem(TOKEN_KEY)
}

/** Authorization headers for requests that require a session token. */
export function getAuthHeaders () {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** POST /auth/login — stores the issued token and returns the user. */
export async function login (username, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Login failed' }))
    throw new Error(err.error || 'Login failed')
  }
  const data = await res.json()
  setToken(data.token)
  return data.user
}

/** GET /auth/me — verify the stored token and return the current user. */
export async function fetchCurrentUser () {
  const res = await fetch(`${BASE}/auth/me`, { headers: getAuthHeaders() })
  if (!res.ok) {
    clearToken()
    throw new Error('Not logged in')
  }
  return res.json()
}
