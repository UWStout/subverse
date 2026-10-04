import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { mockPrisma, TEST_CLASS, TEST_OFFERING, TEST_PROJECT, authedApp } from './setup.js'
import path from 'path'

// ---------------------------------------------------------------------------
// Dynamic import to get a fresh router per test (clears ESM cache + lazy getDb)
// ---------------------------------------------------------------------------
async function getProjectRouter () {
  vi.resetModules()
  const routePath = path.resolve(__dirname, '..', 'routes', 'project.js')
  const mod = await import(routePath)
  return mod.default
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Project API Routes', () => {
  let router
  let app

  beforeEach(async () => {
    router = await getProjectRouter()
    // Wrap so every request carries a valid session token (authenticated client)
    const express = await import('express')
    const rawApp = express.default()
    rawApp.use('/project/', router)
    app = authedApp(rawApp)
  })

  // ---- GET /:class/:term ----
  describe('GET /project/:class/:term', () => {
    it('returns 400 when both class and term are wildcards (no filter provided)', async () => {
      const res = await request(app).get('/project/*/*')
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/at least one/i)
    })

    it('returns projects filtered by class (subject-number) when term is wildcard', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.offering.findMany.mockResolvedValue([TEST_OFFERING])
      mockPrisma.project.aggregate.mockResolvedValue({ _count: { _all: 1 } })
      mockPrisma.project.findMany.mockResolvedValue([TEST_PROJECT])

      const res = await request(app).get('/project/CS-101/*')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.total).toBe(1)
    })

    it('returns projects filtered by term when class is wildcard', async () => {
      mockPrisma.offering.findMany.mockResolvedValue([TEST_OFFERING])
      mockPrisma.project.aggregate.mockResolvedValue({ _count: { _all: 1 } })
      mockPrisma.project.findMany.mockResolvedValue([TEST_PROJECT])

      const res = await request(app).get('/project/*/FALL2025')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.total).toBe(1)
    })

    it('returns projects filtered by both class and term', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.offering.findMany.mockResolvedValue([TEST_OFFERING])
      mockPrisma.project.aggregate.mockResolvedValue({ _count: { _all: 2 } })
      mockPrisma.project.findMany.mockResolvedValue([TEST_PROJECT, { ...TEST_PROJECT, id: 2 }])

      const res = await request(app).get('/project/CS-101/FALL2025')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data).toHaveLength(2)
    })

    it('returns empty paginated response when no projects match the filters', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.offering.findMany.mockResolvedValue([])

      const res = await request(app).get('/project/CS-101/FALL2025')
      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
      expect(res.body.total).toBe(0)
    })

    it('caps limit at maxLimit of 100', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.offering.findMany.mockResolvedValue([TEST_OFFERING])
      mockPrisma.project.aggregate.mockResolvedValue({ _count: { _all: 120 } })
      mockPrisma.project.findMany.mockResolvedValue(Array.from({ length: 100 }, (_, i) => ({ ...TEST_PROJECT, id: i + 1 })))

      const res = await request(app).get('/project/CS-101/FALL2025?limit=200')
      expect(res.status).toBe(200)
      expect(res.body.limit).toBe(100) // capped from 200 to maxLimit
    })

    it('returns 400 for invalid class code format', async () => {
      const res = await request(app).get('/project/not-a-valid-code/FALL2025')
      expect(res.status).toBe(400)
    })

    it('returns 404 when class is not found', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(null)

      const res = await request(app).get('/project/XX-999/FALL2025')
      expect(res.status).toBe(404)
      expect(res.body.error).toMatch(/class/i)
    })

    it('returns 500 on database error', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(TEST_CLASS)
      mockPrisma.offering.findMany.mockRejectedValue(new Error('DB down'))

      const res = await request(app).get('/project/CS-101/FALL2025')
      expect(res.status).toBe(500)
      expect(res.body.error).toMatch(/fail/i)
    })
  })

  // ---- GET /:id ----
  describe('GET /project/:id', () => {
    it('returns 400 for non-numeric ID', async () => {
      const res = await request(app).get('/project/abc')
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid project ID' })
    })

    it('returns 404 when project does not exist', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null)

      const res = await request(app).get('/project/999')
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Project not found' })
    })

    it('returns project details when found', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)

      const res = await request(app).get('/project/1')
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(1)
      expect(res.body.title).toBe('Final Project')
      expect(res.body.description).toBe('Complete final assignment for the course')
    })

    it('returns project with nested offering and teacher info', async () => {
      const projectWithOffering = {
        ...TEST_PROJECT,
        offering: {
          ...TEST_OFFERING,
          class: TEST_CLASS,
          teacher: { id: 1, username: 'prof', email: 'prof@uni.edu' }
        },
        assignments: [
          { student_id: 2, project_id: 1, student: { id: 2, username: 'student1' } }
        ]
      }
      mockPrisma.project.findUnique.mockResolvedValue(projectWithOffering)

      const res = await request(app).get('/project/1')
      expect(res.status).toBe(200)
      expect(res.body.offering.class.subject).toBe('CS')
      expect(res.body.offering.teacher.username).toBe('prof')
      expect(res.body.assignments).toHaveLength(1)
    })

    it('handles project with null description', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ ...TEST_PROJECT, description: null })

      const res = await request(app).get('/project/1')
      expect(res.status).toBe(200)
      expect(res.body.description).toBeNull()
    })

    it('returns 500 on database error', async () => {
      mockPrisma.project.findUnique.mockRejectedValue(new Error('DB down'))

      const res = await request(app).get('/project/1')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to retrieve project' })
    })
  })

  // ---- POST /create ----
  describe('POST /project/create', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/project/create')
        .send({ title: 'Only Title' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/missing|required/i)
    })

    it('returns 400 when offering_id is missing', async () => {
      const res = await request(app)
        .post('/project/create')
        .send({ title: 'New Project', description: 'A desc' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when title is missing', async () => {
      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, description: 'A desc' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when slug is missing', async () => {
      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'New Project' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when slug contains spaces', async () => {
      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'New Project', slug: 'new project' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/invalid slug/i)
    })

    it('returns 400 when slug contains non-latin characters', async () => {
      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'New Project', slug: 'nuevo-proyectó' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when slug contains special characters', async () => {
      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'New Project', slug: 'new/project!' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when slug contains uppercase letters', async () => {
      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'New Project', slug: 'New-Project' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when slug has leading or trailing hyphens', async () => {
      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'New Project', slug: '-new-project-' })
      expect(res.status).toBe(400)
    })

    it('does not create a project when the slug is invalid', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)

      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'New Project', slug: 'bad slug' })
      expect(res.status).toBe(400)
      expect(mockPrisma.project.create).not.toHaveBeenCalled()
    })

    it('returns 404 when the offering does not exist', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 999, title: 'New Project', slug: 'new-project' })
      expect(res.status).toBe(404)
      expect(res.body.error).toMatch(/offering/i)
    })

    it('creates a project successfully with title and offering_id', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.project.create.mockResolvedValue({ ...TEST_PROJECT, title: 'New Project' })

      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'New Project', slug: 'new-project' })
      expect(res.status).toBe(201)
      expect(res.body.id).toBe(1)
      expect(res.body.title).toBe('New Project')
    })

    it('creates a project with git_url', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      const projectWithGit = { ...TEST_PROJECT, git_url: 'https://github.com/example/my-repo.git' }
      mockPrisma.project.create.mockResolvedValue(projectWithGit)

      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'New Project', slug: 'new-project', git_url: 'https://github.com/example/my-repo.git' })
      expect(res.status).toBe(201)
      expect(res.body.git_url).toBe('https://github.com/example/my-repo.git')
    })

    it('creates a project with subversion_url', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      const projectWithSvn = { ...TEST_PROJECT, subversion_url: 'https://svn.example.com/repos/my-repo' }
      mockPrisma.project.create.mockResolvedValue(projectWithSvn)

      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'New Project', slug: 'new-project', subversion_url: 'https://svn.example.com/repos/my-repo' })
      expect(res.status).toBe(201)
      expect(res.body.subversion_url).toBe('https://svn.example.com/repos/my-repo')
    })

    it('creates a project with description', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      const projectWithDesc = { ...TEST_PROJECT, description: 'Detailed description here' }
      mockPrisma.project.create.mockResolvedValue(projectWithDesc)

      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'New Project', slug: 'new-project', description: 'Detailed description here' })
      expect(res.status).toBe(201)
      expect(res.body.description).toBe('Detailed description here')
    })

    it('creates a project with null description when omitted', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.project.create.mockResolvedValue({ ...TEST_PROJECT, description: null })

      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'Minimal Project', slug: 'minimal-project' })
      expect(res.status).toBe(201)
    })

    it('returns 500 on database error during offering lookup', async () => {
      mockPrisma.offering.findUnique.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'New Project', slug: 'new-project' })
      expect(res.status).toBe(500)
      expect(res.body.error).toMatch(/fail/i)
    })

    it('returns 500 on database error during project creation', async () => {
      mockPrisma.offering.findUnique.mockResolvedValue(TEST_OFFERING)
      mockPrisma.project.create.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .post('/project/create')
        .send({ offering_id: 1, title: 'New Project', slug: 'new-project' })
      expect(res.status).toBe(500)
      expect(res.body.error).toMatch(/fail/i)
    })
  })

  // ---- POST /update/:id ----
  describe('POST /project/update/:id', () => {
    it('returns 400 for non-numeric ID', async () => {
      const res = await request(app)
        .post('/project/update/abc')
        .send({})
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid project ID' })
    })

    it('returns 400 when no update fields are provided', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)

      const res = await request(app)
        .post('/project/update/1')
        .send({})
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'No update fields provided' })
    })

    it('returns 404 when project does not exist', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .post('/project/update/999')
        .send({ title: 'Updated' })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Project not found' })
    })

    it('updates title successfully', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
      mockPrisma.project.update.mockResolvedValue({ ...TEST_PROJECT, title: 'Updated Title' })

      const res = await request(app)
        .post('/project/update/1')
        .send({ title: 'Updated Title' })
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Updated Title')
    })

    it('updates description successfully', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
      mockPrisma.project.update.mockResolvedValue({ ...TEST_PROJECT, description: 'New description' })

      const res = await request(app)
        .post('/project/update/1')
        .send({ description: 'New description' })
      expect(res.status).toBe(200)
      expect(res.body.description).toBe('New description')
    })

    it('updates slug successfully', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
      mockPrisma.project.update.mockResolvedValue({ ...TEST_PROJECT, slug: 'renamed-project' })

      const res = await request(app)
        .post('/project/update/1')
        .send({ slug: 'renamed-project' })
      expect(res.status).toBe(200)
      expect(res.body.slug).toBe('renamed-project')
    })

    it('returns 400 when updating slug with spaces', async () => {
      const res = await request(app)
        .post('/project/update/1')
        .send({ slug: 'renamed project' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/invalid slug/i)
    })

    it('returns 400 when updating slug with non-latin characters', async () => {
      const res = await request(app)
        .post('/project/update/1')
        .send({ slug: 'проект' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when updating slug with special characters', async () => {
      const res = await request(app)
        .post('/project/update/1')
        .send({ slug: 'a_b/c' })
      expect(res.status).toBe(400)
    })

    it('does not update the project when the slug is invalid', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)

      const res = await request(app)
        .post('/project/update/1')
        .send({ slug: 'bad slug' })
      expect(res.status).toBe(400)
      expect(mockPrisma.project.update).not.toHaveBeenCalled()
    })

    it('updates git_url successfully', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
      mockPrisma.project.update.mockResolvedValue({ ...TEST_PROJECT, git_url: 'https://gitlab.com/example/new-repo.git' })

      const res = await request(app)
        .post('/project/update/1')
        .send({ git_url: 'https://gitlab.com/example/new-repo.git' })
      expect(res.status).toBe(200)
      expect(res.body.git_url).toBe('https://gitlab.com/example/new-repo.git')
    })

    it('updates subversion_url successfully', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
      mockPrisma.project.update.mockResolvedValue({ ...TEST_PROJECT, subversion_url: 'https://svn.example.com/repos/new-repo' })

      const res = await request(app)
        .post('/project/update/1')
        .send({ subversion_url: 'https://svn.example.com/repos/new-repo' })
      expect(res.status).toBe(200)
      expect(res.body.subversion_url).toBe('https://svn.example.com/repos/new-repo')
    })

    it('clears git_url when set to empty string', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
      mockPrisma.project.update.mockResolvedValue({ ...TEST_PROJECT, git_url: null })

      const res = await request(app)
        .post('/project/update/1')
        .send({ git_url: '' })
      expect(res.status).toBe(200)
      expect(res.body.git_url).toBeNull()
    })

    it('updates offering_id successfully after validating the new offering exists', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
      mockPrisma.offering.findUnique.mockResolvedValue({ ...TEST_OFFERING, id: 2 })
      mockPrisma.project.update.mockResolvedValue({ ...TEST_PROJECT, offering_id: 2 })

      const res = await request(app)
        .post('/project/update/1')
        .send({ offering_id: 2 })
      expect(res.status).toBe(200)
      expect(res.body.offering_id).toBe(2)
    })

    it('returns 404 when updating offering_id to a non-existent offering', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
      mockPrisma.offering.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .post('/project/update/1')
        .send({ offering_id: 999 })
      expect(res.status).toBe(404)
      expect(res.body.error).toMatch(/offering/i)
    })

    it('updates multiple fields at once', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
      mockPrisma.project.update.mockResolvedValue({
        id: 1, offering_id: 1, title: 'Renamed Project', description: 'Updated notes'
      })

      const res = await request(app)
        .post('/project/update/1')
        .send({ title: 'Renamed Project', description: 'Updated notes' })
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Renamed Project')
      expect(res.body.description).toBe('Updated notes')
    })

    it('returns 500 on database error', async () => {
      mockPrisma.project.findUnique.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .post('/project/update/1')
        .send({ title: 'x' })
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to update project' })
    })
  })

  // ---- DELETE /:id ----
  describe('DELETE /project/:id', () => {
    it('returns 400 for non-numeric ID', async () => {
      const res = await request(app).delete('/project/abc')
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid project ID' })
    })

    it('returns 404 when project does not exist', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null)

      const res = await request(app).delete('/project/999')
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Project not found' })
    })

    it('deletes a project successfully', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
      mockPrisma.project.delete.mockResolvedValue(TEST_PROJECT)

      const res = await request(app).delete('/project/1')
      expect(res.status).toBe(200)
      expect(res.body.message).toMatch(/delet/i)
    })

    it('cascades deletion of associated assignments', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
      mockPrisma.assignment.deleteMany.mockResolvedValue({ count: 3 })
      mockPrisma.project.delete.mockResolvedValue(TEST_PROJECT)

      const res = await request(app).delete('/project/1')
      expect(res.status).toBe(200)
      expect(mockPrisma.assignment.deleteMany).toHaveBeenCalled()
    })

    it('returns 500 on database error during lookup', async () => {
      mockPrisma.project.findUnique.mockRejectedValue(new Error('DB down'))

      const res = await request(app).delete('/project/1')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to delete project' })
    })

    it('returns 500 on database error during deletion', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
      mockPrisma.assignment.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.project.delete.mockRejectedValue(new Error('DB down'))

      const res = await request(app).delete('/project/1')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to delete project' })
    })
  })
})

// ---------------------------------------------------------------------------
// Authentication â€” every route on this router requires a valid session token
// ---------------------------------------------------------------------------
describe('Authentication', () => {
  let app

  beforeEach(async () => {
    const router = await getProjectRouter()
    const express = await import('express')
    app = express.default()
    app.use('/project/', router)
  })

  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/project/*/FALL2025')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/authorization/i)
  })

  it('returns 401 for a malformed Authorization header', async () => {
    const res = await request(app)
      .get('/project/*/FALL2025')
      .set('Authorization', 'Token abc123')
    expect(res.status).toBe(401)
  })

  it('returns 401 for a token signed with the wrong secret', async () => {
    const badToken = jwt.sign({ sub: 1, username: 'testuser' }, 'wrong-secret', { expiresIn: '8h' })
    const res = await request(app)
      .get('/project/*/FALL2025')
      .set('Authorization', `Bearer ${badToken}`)
    expect(res.status).toBe(401)
  })
})
