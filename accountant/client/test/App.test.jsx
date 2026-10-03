import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from '../src/App'
import {
  fetchCurrentUser,
  login,
  fetchUsers,
  fetchOfferings,
  fetchOfferingTerms
} from '../src/services/api'

// Mock the whole API layer so the app boots without a network.
vi.mock('../src/services/api', () => ({
  fetchCurrentUser: vi.fn(),
  clearToken: vi.fn(),
  login: vi.fn(),
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
  fetchTeachers: vi.fn()
}))

const ADMIN = { id: 3, username: 'admin', type: 'ADMIN' }
const TEACHER = { id: 1, username: 'prof', type: 'TEACHER' }

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
    fetchUsers.mockResolvedValue({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 })
    fetchOfferings.mockResolvedValue({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 })
    fetchOfferingTerms.mockResolvedValue([])
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

  it('redirects an admin away from /offerings to the users page (current role config)', async () => {
    fetchCurrentUser.mockResolvedValue(ADMIN)

    visit('/offerings')
    render(<App />)

    expect(await screen.findByText('User Accounts')).toBeInTheDocument()
    expect(screen.queryByText('Class Offerings')).not.toBeInTheDocument()
  })
})
