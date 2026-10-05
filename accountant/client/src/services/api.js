/**
 * API client helpers for the Accountant REST API.
 *
 * In development Vite proxies /user, /class, /project → http://localhost:3000
 * In production Express serves both static files and API routes directly.
 *
 * Every endpoint except POST /auth/login requires a session token, sent as an
 * `Authorization: Bearer <token>` header (see getAuthHeaders).
 */

const BASE = '' // no prefix – routes are proxied / forwarded as-is

/* ------------------------------------------------------------------ */
/*  Session token                                                      */
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

/** Drop a stale stored token when the server rejects it (401). */
function handleUnauthorized (res) {
  if (res.status === 401) clearToken()
}

/* ------------------------------------------------------------------ */
/*  Users                                                              */
/* ------------------------------------------------------------------ */

/**
 * GET /user/list/:type  (type = 'STUDENT' | 'TEACHER' | 'ADMIN' | '*' | comma-separated list of types)
 * Query params: ?page=N&limit=N  (defaults: page=1, limit=25)
 * Returns { data, total, page, limit, totalPages }
 */
export async function fetchUsers (type = '*', page = 1, limit = 25) {
  const res = await fetch(`${BASE}/user/list/${type}?page=${page}&limit=${limit}`, { headers: getAuthHeaders() })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to list users' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/** GET /user/:id */
export async function fetchUser (id) {
  const res = await fetch(`${BASE}/user/${id}`, { headers: getAuthHeaders() })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to fetch user' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/** GET /user/check/:username/:email */
export async function checkAvailability (username, email) {
  const res = await fetch(`${BASE}/user/check/${encodeURIComponent(username)}/${encodeURIComponent(email)}`, { headers: getAuthHeaders() })
  if (!res.ok) {
    handleUnauthorized(res)
    throw new Error('Failed to check availability')
  }
  return res.json()
}

/** POST /user/create */
export async function createUser ({ username, email, password, type, firstName, lastName }) {
  const res = await fetch(`${BASE}/user/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ username, email, password, type, first_name: firstName, last_name: lastName })
  })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to create user' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json() // { user: ... }
}

/** POST /user/update/:id */
export async function updateUser (id, { username, email, password, type, firstName, lastName }) {
  const res = await fetch(`${BASE}/user/update/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ username, email, password, type, first_name: firstName, last_name: lastName })
  })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to update user' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json() // { user: ... }
}

/** DELETE /user/:id */
export async function deleteUser (id) {
  const res = await fetch(`${BASE}/user/${id}`, { method: 'DELETE', headers: getAuthHeaders() })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to delete user' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/* ------------------------------------------------------------------ */
/*  Offerings                                                          */
/* ------------------------------------------------------------------ */

/**
 * GET /offering/list/:term/:class_id/:teacher_id
 * Each positional filter accepts a concrete value or '*' for "any".
 * Query params: ?page=N&limit=N  (defaults: page=1, limit=25)
 * Returns { data, total, page, limit, totalPages } of plain offering rows -
 * no joined class / teacher details (use the details route for those).
 */
export async function fetchOfferings (term = '*', classId = '*', teacherId = '*', page = 1, limit = 25) {
  const res = await fetch(`${BASE}/offering/list/${term}/${classId}/${teacherId}?page=${page}&limit=${limit}`, { headers: getAuthHeaders() })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to list offerings' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/** GET /offering/terms - distinct term values for filter chips. */
export async function fetchOfferingTerms () {
  const res = await fetch(`${BASE}/offering/terms`, { headers: getAuthHeaders() })
  if (!res.ok) {
    handleUnauthorized(res)
    throw new Error('Failed to list offering terms')
  }
  const data = await res.json()
  return data.terms || []
}

/** POST /offering/create */
export async function createOffering ({ classId, teacherId, term, section }) {
  const res = await fetch(`${BASE}/offering/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ class_id: classId, teacher_id: teacherId, term, section })
  })
  if (!res.ok) {
    handleUnauthorized(res)
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
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to update offering' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json() // the updated offering
}

/** DELETE /offering/:id */
export async function deleteOffering (id) {
  const res = await fetch(`${BASE}/offering/${id}`, { method: 'DELETE', headers: getAuthHeaders() })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to delete offering' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/* ------------------------------------------------------------------ */
/*  Projects                                                           */
/* ------------------------------------------------------------------ */

/**
 * GET /project/list/:class/:term
 * `class` is a subject-number code (e.g. 'CS-101') and `term` a term value
 * (e.g. 'FALL25'); each position accepts '*' for "any", but at least one
 * must be concrete or the server returns 400.
 * Query params: ?page=N&limit=N  (defaults: page=1, limit=25)
 * Returns { data, total, page, limit, totalPages } of plain project rows -
 * no joined offering / class details (use the details route for those).
 */
export async function fetchProjects (classCode = '*', term = '*', page = 1, limit = 25) {
  const res = await fetch(`${BASE}/project/list/${classCode}/${term}?page=${page}&limit=${limit}`, { headers: getAuthHeaders() })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to list projects' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/** POST /project/create */
export async function createProject ({ offeringId, title, slug, subversionUrl, gitUrl, description }) {
  const res = await fetch(`${BASE}/project/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({
      offering_id: offeringId,
      title,
      slug,
      subversion_url: subversionUrl ?? null,
      git_url: gitUrl ?? null,
      description: description ?? null
    })
  })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to create project' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json() // the created project
}

/** POST /project/update/:id - only fields that are defined are sent (partial update). */
export async function updateProject (id, { offeringId, title, slug, subversionUrl, gitUrl, description }) {
  const payload = {}
  if (offeringId !== undefined) payload.offering_id = offeringId
  if (title !== undefined) payload.title = title
  if (slug !== undefined) payload.slug = slug
  if (subversionUrl !== undefined) payload.subversion_url = subversionUrl
  if (gitUrl !== undefined) payload.git_url = gitUrl
  if (description !== undefined) payload.description = description

  const res = await fetch(`${BASE}/project/update/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to update project' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json() // the updated project
}

/** DELETE /project/:id */
export async function deleteProject (id) {
  const res = await fetch(`${BASE}/project/${id}`, { method: 'DELETE', headers: getAuthHeaders() })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to delete project' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/* ------------------------------------------------------------------ */
/*  Classes & Teachers (option lists for the offering form)            */
/* ------------------------------------------------------------------ */

/** POST /class/create - creates a class and returns it (with its new id). */
export async function createClass ({ subject, number, title }) {
  const res = await fetch(`${BASE}/class/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ subject, number, title })
  })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to create class' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json() // the created class
}

/**
 * GET /class/list/:subject/:number - classes, optionally filtered by
 * subject and/or number ('*' means "any"), used to populate the class
 * selector in the offering form.
 * Returns { data, total, page, limit, totalPages }
 */
export async function fetchClasses (page = 1, limit = 100) {
  const res = await fetch(`${BASE}/class/list/*/*?page=${page}&limit=${limit}`, { headers: getAuthHeaders() })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to list classes' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/**
 * GET /user/list/TEACHER,ADMIN - all teacher and admin accounts (both are
 * eligible to be an offering instructor), used to populate the teacher
 * selector in the offering form.
 * Returns { data, total, page, limit, totalPages }
 */
export async function fetchTeachers (page = 1, limit = 100) {
  const res = await fetch(`${BASE}/user/list/TEACHER,ADMIN?page=${page}&limit=${limit}`, { headers: getAuthHeaders() })
  if (!res.ok) {
    handleUnauthorized(res)
    const err = await res.json().catch(() => ({ error: 'Failed to list teachers' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

/* ------------------------------------------------------------------ */
/*  Auth                                                               */
/* ------------------------------------------------------------------ */

/** POST /auth/login - public endpoint; stores the issued token and returns the user. */
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

/** GET /auth/me - verify the stored token and return the current user. */
export async function fetchCurrentUser () {
  const res = await fetch(`${BASE}/auth/me`, { headers: getAuthHeaders() })
  if (!res.ok) {
    clearToken()
    throw new Error('Not logged in')
  }
  return res.json()
}

/**
 * GET /auth/bootstrap/status - public endpoint.
 * Returns true when the server has no user accounts yet (bootstrap mode).
 */
export async function fetchBootstrapStatus () {
  const res = await fetch(`${BASE}/auth/bootstrap/status`)
  if (!res.ok) {
    throw new Error('Failed to check bootstrap status')
  }
  const data = await res.json()
  return data.bootstrap === true
}

/**
 * POST /auth/bootstrap - public, single-use endpoint.
 * Creates the initial ADMIN account using the one-time signed token that the
 * server printed to its logs at first startup.
 */
export async function createBootstrapAccount ({ token, username, email, password, firstName, lastName }) {
  const res = await fetch(`${BASE}/auth/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, username, email, password, first_name: firstName, last_name: lastName })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to create initial account' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json() // { message, user }
}
