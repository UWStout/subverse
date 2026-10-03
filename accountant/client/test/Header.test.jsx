import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Header from '../src/components/Header'
import { ThemeProvider } from '../src/context/ThemeContext'
import { useAuth } from '../src/context/AuthContext'

// Mock the auth context — the header only consumes the useAuth hook.
vi.mock('../src/context/AuthContext', () => ({
  useAuth: vi.fn()
}))

const TEACHER = { id: 1, username: 'prof', type: 'TEACHER' }
const STUDENT = { id: 2, username: 'student', type: 'STUDENT' }
const ADMIN = { id: 3, username: 'admin', type: 'ADMIN' }

/** Render the header with a given auth user. */
function renderHeader (user) {
  useAuth.mockReturnValue({ user, loading: false, logout: vi.fn() })
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/users']}>
        <Header />
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Note: MUI Buttons rendered with component={Link} are <a> elements, so the
  // nav items expose role="link" (the theme toggle is the only real button).

  it('shows the brand and the Users link for everyone', () => {
    renderHeader(null)

    expect(screen.getByText('Accountant')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument()
  })

  it('shows a Login link (no Logout) when anonymous', () => {
    renderHeader(null)

    expect(screen.getByRole('link', { name: 'Login' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Logout' })).not.toBeInTheDocument()
  })

  it('shows a Logout link (no Login) when authenticated', () => {
    renderHeader(TEACHER)

    expect(screen.getByRole('link', { name: 'Logout' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Login' })).not.toBeInTheDocument()
  })

  // The Offerings link is role-restricted — see NAV_LINKS in Header.jsx.
  it('shows the Offerings link for users with an allowed role', () => {
    renderHeader(TEACHER)

    expect(screen.getByRole('link', { name: 'Offerings' })).toBeInTheDocument()
  })

  it('hides the Offerings link from students', () => {
    renderHeader(STUDENT)

    expect(screen.queryByRole('link', { name: 'Offerings' })).not.toBeInTheDocument()
  })

  it('hides the Offerings link from admins (current NAV_LINKS config)', () => {
    renderHeader(ADMIN)

    expect(screen.queryByRole('link', { name: 'Offerings' })).not.toBeInTheDocument()
  })
})
