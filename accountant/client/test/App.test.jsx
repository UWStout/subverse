import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from '../src/App'
import {
  fetchCurrentUser,
  login,
  fetchBootstrapStatus,
  fetchUsers,
  fetchOfferings,
  fetchOfferingTerms,
  fetchClasses,
  fetchProjects
} from '../src/services/api'

// Mock the whole API layer so the app boots without a network.
vi.mock('../src/services/api', () => ({
  fetchCurrentUser: vi.fn(),
  clearToken: vi.fn(),
  login: vi.fn(),
  fetchBootstrapStatus: vi.fn(),
  fetchUsers: vi.fn(),
  deleteUser: vi.fn(),
  checkAvailability: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  fetchOfferings: vi.fn(),
  fetchOfferingTerms: vi.fn(),
  deleteOffering: vi.fn(),
  createOffering: vi.fn(),
  updateOffering: vi.fn(),
  fetchClasses: vi.fn(),
  fetchTeachers: vi.fn(),
  fetchProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn()
}))

const ADMIN = { id: 3, username: 'admin', type: 'ADMIN' }
const TEACHER = { id: 1, username: 'prof', type: 'TEACHER' }
const STUDENT = { id: 2, username: 'student', type: 'STUDENT' }

/** Point the (real) BrowserRouter at a path before rendering. */
function visit (path) {
  window.history.pushState({}, '', path)
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    fetchCurrentUser.mockRejectedValue(new Error('Not logged in'))
    login.mockResolvedValue(undefined)
    fetchBootstrapStatus.mockResolvedValue(false)
    fetchUsers.mockResolvedValue({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 })
    fetchOfferings.mockResolvedValue({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 })
    fetchOfferingTerms.mockResolvedValue([])
    fetchClasses.mockResolvedValue({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 })
    fetchProjects.mockResolvedValue({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 })
  })

  it('redirects anonymous visitors to the login page', async () => {
    visit('/')
    render(<App />)

    // The Users/Offerings routes are private; /login is public
    expect(await screen.findByLabelText('Username')).toBeInTheDocument()
    expect(screen.queryByText('User Accounts')).not.toBeInTheDocument()
  })

  it('shows the users page for an authenticated admin', async () => {
    fetchCurrentUser.mockResolvedValue(ADMIN)

    visit('/users')
    render(<App />)

    expect(await screen.findByText('User Accounts')).toBeInTheDocument()
  })

  it('shows the offerings page for a teacher', async () => {
    fetchCurrentUser.mockResolvedValue(TEACHER)

    visit('/offerings')
    render(<App />)

    expect(await screen.findByText('Class Offerings')).toBeInTheDocument()
  })

  it('shows the offerings page for an admin', async () => {
    fetchCurrentUser.mockResolvedValue(ADMIN)

    visit('/offerings')
    render(<App />)

    expect(await screen.findByText('Class Offerings')).toBeInTheDocument()
  })

  it('shows the projects page for a student (read-only view)', async () => {
    fetchCurrentUser.mockResolvedValue(STUDENT)

    visit('/projects')
    render(<App />)

    expect(await screen.findByText('Class Projects')).toBeInTheDocument()
    // Students get no create / edit / delete controls
    expect(screen.queryByRole('button', { name: 'Add Project' })).not.toBeInTheDocument()
  })

  it('shows the projects page for a teacher with the add button', async () => {
    fetchCurrentUser.mockResolvedValue(TEACHER)

    visit('/projects')
    render(<App />)

    expect(await screen.findByText('Class Projects')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Project' })).toBeInTheDocument()
  })

  it('shows a 404 page for unknown routes (not the users page)', async () => {
    fetchCurrentUser.mockResolvedValue(ADMIN)

    visit('/bubble')
    render(<App />)

    expect(await screen.findByText('Page not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Users' })).toBeInTheDocument()
    expect(screen.queryByText('User Accounts')).not.toBeInTheDocument()
  })

  it('shows a 404 page for unknown routes even when anonymous', async () => {
    visit('/bubble')
    render(<App />)

    expect(await screen.findByText('Page not found')).toBeInTheDocument()
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
  })
})
