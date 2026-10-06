import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Login from '../src/pages/Login'
import { useAuth } from '../src/context/AuthContext'
import { login, fetchBootstrapStatus, createBootstrapAccount } from '../src/services/api'

// Mock the auth context - Login only consumes the useAuth hook.
vi.mock('../src/context/AuthContext', () => ({
  useAuth: vi.fn()
}))

// Mock the API layer so tests never touch the network (mirrors how the
// server suite mocks Prisma/bcrypt in server/test/setup.js).
vi.mock('../src/services/api', () => ({
  login: vi.fn(),
  fetchBootstrapStatus: vi.fn(),
  createBootstrapAccount: vi.fn()
}))

let setUser

function renderLogin (user = null) {
  useAuth.mockReturnValue({ user, setUser })
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path='/login' element={<Login />} />
        <Route path='/users' element={<div>Users page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Login page', () => {
  let user

  beforeEach(async () => {
    vi.clearAllMocks()
    setUser = vi.fn()
    login.mockResolvedValue(undefined)
    fetchBootstrapStatus.mockResolvedValue(false)
    createBootstrapAccount.mockResolvedValue({ message: 'ok', user: { id: 1, type: 'ADMIN' } })
    user = await userEvent.setup()
  })

  it('renders the login form', async () => {
    renderLogin()

    // The page briefly shows a loading state while checking bootstrap status
    expect(await screen.findByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('submits the entered credentials to the API', async () => {
    renderLogin()

    await user.type(await screen.findByLabelText('Username'), 'testuser')
    await user.type(screen.getByLabelText('Password'), 'password')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(login).toHaveBeenCalledWith('testuser', 'password')
  })

  it('updates the auth context and redirects to the users page on successful login', async () => {
    login.mockResolvedValue({ id: 1, username: 'alice' })
    renderLogin()

    await user.type(await screen.findByLabelText('Username'), 'testuser')
    await user.type(screen.getByLabelText('Password'), 'password')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByText('Users page')).toBeInTheDocument()
    expect(setUser).toHaveBeenCalledWith({ id: 1, username: 'alice' })
  })

  it('does not call the API when the form is empty', async () => {
    renderLogin()

    await user.click(await screen.findByRole('button', { name: 'Sign In' }))

    expect(login).not.toHaveBeenCalled()
  })

  it('shows an error message when login fails', async () => {
    login.mockRejectedValue(new Error('Invalid credentials'))
    renderLogin()

    await user.type(await screen.findByLabelText('Username'), 'testuser')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument()
  })

  it('redirects authenticated users to the users page', async () => {
    renderLogin({ id: 1, username: 'alice' })

    expect(await screen.findByText('Users page')).toBeInTheDocument()
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
  })

  // ---- Bootstrap mode (server has no accounts yet) ----
  describe('bootstrap mode', () => {
    it('shows the initial admin form instead of the sign-in form', async () => {
      fetchBootstrapStatus.mockResolvedValue(true)
      renderLogin()

      expect(await screen.findByRole('heading', { name: 'Create Initial Admin Account' })).toBeInTheDocument()
      expect(screen.getByLabelText('Bootstrap Token')).toBeInTheDocument()
      expect(screen.getByText(/one-time bootstrap token in the server logs/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Sign In' })).not.toBeInTheDocument()
    })

    it('submits all account details and the token to the API', async () => {
      fetchBootstrapStatus.mockResolvedValue(true)
      renderLogin()

      await user.type(await screen.findByLabelText('Username'), 'rootadmin')
      await user.type(screen.getByLabelText('First Name'), 'Root')
      await user.type(screen.getByLabelText('Last Name'), 'Admin')
      await user.type(screen.getByLabelText('Email'), 'root@example.com')
      await user.type(screen.getByLabelText('Password'), 'sup3r-secret')
      await user.type(screen.getByLabelText('Confirm Password'), 'sup3r-secret')
      await user.type(screen.getByLabelText('Bootstrap Token'), 'token-abc123')
      await user.click(screen.getByRole('button', { name: 'Create Admin Account' }))

      expect(createBootstrapAccount).toHaveBeenCalledWith({
        token: 'token-abc123',
        username: 'rootadmin',
        email: 'root@example.com',
        password: 'sup3r-secret',
        firstName: 'Root',
        lastName: 'Admin'
      })
    })

    it('shows a server error when bootstrap creation fails', async () => {
      fetchBootstrapStatus.mockResolvedValue(true)
      createBootstrapAccount.mockRejectedValue(new Error('Invalid bootstrap token'))
      renderLogin()

      await user.type(await screen.findByLabelText('Username'), 'rootadmin')
      await user.type(screen.getByLabelText('Email'), 'root@example.com')
      await user.type(screen.getByLabelText('Password'), 'sup3r-secret')
      await user.type(screen.getByLabelText('Confirm Password'), 'sup3r-secret')
      await user.type(screen.getByLabelText('Bootstrap Token'), 'bad-token')
      await user.click(screen.getByRole('button', { name: 'Create Admin Account' }))

      expect(await screen.findByText('Invalid bootstrap token')).toBeInTheDocument()
    })

    it('returns to the sign-in form after the account is created', async () => {
      fetchBootstrapStatus.mockResolvedValue(true)
      renderLogin()

      await user.type(await screen.findByLabelText('Username'), 'rootadmin')
      await user.type(screen.getByLabelText('Email'), 'root@example.com')
      await user.type(screen.getByLabelText('Password'), 'sup3r-secret')
      await user.type(screen.getByLabelText('Confirm Password'), 'sup3r-secret')
      await user.type(screen.getByLabelText('Bootstrap Token'), 'token-abc123')
      await user.click(screen.getByRole('button', { name: 'Create Admin Account' }))

      expect(await screen.findByText(/Initial admin account created/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
      expect(screen.queryByLabelText('Bootstrap Token')).not.toBeInTheDocument()
    })
  })
})
