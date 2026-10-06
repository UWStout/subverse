import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Header from '../src/components/Header'
import { ThemeProvider } from '../src/context/ThemeContext'
import { useAuth } from '../src/context/AuthContext'

// Mock the auth context - the header only consumes the useAuth hook.
vi.mock('../src/context/AuthContext', () => ({
  useAuth: vi.fn()
}))

const TEACHER = { id: 1, username: 'prof', type: 'TEACHER' }
const STUDENT = { id: 2, username: 'student', type: 'STUDENT' }
const ADMIN = { id: 3, username: 'admin', type: 'ADMIN' }

let logoutMock

/** Render the header with a given auth user. */
function renderHeader (user) {
  logoutMock = vi.fn()
  useAuth.mockReturnValue({ user, loading: false, logout: logoutMock })
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

  // Note: MUI Buttons rendered with component={Link} are <a> elements and
  // expose role="link"; the theme toggle and (when authenticated) Logout are
  // real buttons.

  it('shows the brand and the Users link for everyone', () => {
    renderHeader(null)

    expect(screen.getByText('Accountant')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument()
  })

  it('shows a Login link (no Logout) when anonymous', () => {
    renderHeader(null)

    expect(screen.getByRole('link', { name: 'Login' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Logout' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument()
  })

  it('shows a Logout button (no Login) when authenticated', () => {
    renderHeader(TEACHER)

    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Login' })).not.toBeInTheDocument()
  })

  it('calls the auth logout function when Logout is clicked', async () => {
    renderHeader(TEACHER)
    const user = await userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Logout' }))

    expect(logoutMock).toHaveBeenCalledTimes(1)
  })

  // The Offerings link is role-restricted - see NAV_LINKS in Header.jsx.
  it('shows the Offerings link for users with an allowed role', () => {
    renderHeader(TEACHER)

    expect(screen.getByRole('link', { name: 'Offerings' })).toBeInTheDocument()
  })

  it('hides the Offerings link from students', () => {
    renderHeader(STUDENT)

    expect(screen.queryByRole('link', { name: 'Offerings' })).not.toBeInTheDocument()
  })

  it('shows the Offerings link for admins (hidden only from students)', () => {
    renderHeader(ADMIN)

    expect(screen.getByRole('link', { name: 'Offerings' })).toBeInTheDocument()
  })
})
