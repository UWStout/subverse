import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Header from '../src/components/Header'
import { ThemeProvider } from '../src/context/ThemeContext'
import { useAuth } from '../src/context/AuthContext'
import { checkAvailability, createUser, fetchCurrentUser, updateUser } from '../src/services/api'

// Mock the auth context - the header only consumes the useAuth hook.
vi.mock('../src/context/AuthContext', () => ({
  useAuth: vi.fn()
}))

// Mock the API layer so tests never touch the network (the header refreshes
// the current user after a self-update, and UserForm submits through it).
vi.mock('../src/services/api', () => ({
  checkAvailability: vi.fn(),
  createUser: vi.fn(),
  fetchCurrentUser: vi.fn(),
  updateUser: vi.fn()
}))

const TEACHER = { id: 1, username: 'prof', type: 'TEACHER' }
const STUDENT = { id: 2, username: 'student', type: 'STUDENT' }
const ADMIN = { id: 3, username: 'admin', type: 'ADMIN' }
const PROFILED_TEACHER = {
  id: 1,
  username: 'prof',
  first_name: 'Prof',
  last_name: 'Essor',
  email: 'prof@uni.edu',
  type: 'TEACHER'
}

let logoutMock
let setUserMock

/** Render the header with a given auth user. */
function renderHeader (user) {
  logoutMock = vi.fn()
  setUserMock = vi.fn()
  useAuth.mockReturnValue({ user, loading: false, logout: logoutMock, setUser: setUserMock })
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/users']}>
        <Header />
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('Header', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    checkAvailability.mockResolvedValue({ available: true })
    createUser.mockResolvedValue({ user: PROFILED_TEACHER })
    updateUser.mockResolvedValue({ user: PROFILED_TEACHER })
    fetchCurrentUser.mockResolvedValue(PROFILED_TEACHER)
  })

  // Note: MUI Buttons rendered with component={Link} are <a> elements and
  // expose role="link"; the theme toggle and (when authenticated) the account
  // menu avatar are real buttons.

  it('shows the brand and the Users link for everyone', () => {
    renderHeader(null)

    expect(screen.getByText('Accountant')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument()
  })

  it('shows a Login link (no account menu) when anonymous', () => {
    renderHeader(null)

    expect(screen.getByRole('link', { name: 'Login' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
  })

  it('shows an account menu button (no Login) when authenticated', () => {
    renderHeader(TEACHER)

    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Login' })).not.toBeInTheDocument()
  })

  it('shows the user\'s initials in the avatar', () => {
    renderHeader(PROFILED_TEACHER)

    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveTextContent('PE')
  })

  it('opens a context menu with Edit Account and Logout options', async () => {
    renderHeader(TEACHER)
    const user = await userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Account menu' }))

    expect(await screen.findByRole('menuitem', { name: 'Edit Account' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Logout' })).toBeInTheDocument()
  })

  it('calls the auth logout function when Logout is chosen from the menu', async () => {
    renderHeader(TEACHER)
    const user = await userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Logout' }))

    expect(logoutMock).toHaveBeenCalledTimes(1)
  })

  it('opens the self-edit form prefilled with the current user', async () => {
    renderHeader(PROFILED_TEACHER)
    const user = await userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit Account' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Edit Account')
    expect(screen.getByLabelText('Username')).toHaveValue('prof')
    expect(screen.getByLabelText('First Name')).toHaveValue('Prof')
    expect(screen.getByLabelText('Last Name')).toHaveValue('Essor')
    expect(screen.getByLabelText('Email')).toHaveValue('prof@uni.edu')
    // The type is locked when editing one's own account
    expect(screen.getByText(/Only admins can change an account type/)).toBeInTheDocument()
  })

  it('saves a self-update without sending the type and refreshes the auth context', async () => {
    const updated = { ...PROFILED_TEACHER, email: 'new@uni.edu' }
    updateUser.mockResolvedValue({ user: updated })
    fetchCurrentUser.mockResolvedValue(updated)

    renderHeader(PROFILED_TEACHER)
    const user = await userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit Account' }))

    await user.clear(screen.getByLabelText('Email'))
    await user.type(screen.getByLabelText('Email'), 'new@uni.edu')

    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    // The payload omits `type` so non-admins never trip the server rule that
    // only admins may change a user type.
    expect(updateUser).toHaveBeenCalledWith(1, {
      username: 'prof',
      email: 'new@uni.edu',
      password: '',
      firstName: 'Prof',
      lastName: 'Essor'
    })
    // The auth context is refreshed with the updated profile
    await waitFor(() => expect(setUserMock).toHaveBeenCalledWith(updated))
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
