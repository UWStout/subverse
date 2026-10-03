import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Login from '../src/pages/Login'
import { useAuth } from '../src/context/AuthContext'
import { login } from '../src/services/api'

// Mock the auth context — Login only consumes the useAuth hook.
vi.mock('../src/context/AuthContext', () => ({
  useAuth: vi.fn()
}))

// Mock the API layer so tests never touch the network (mirrors how the
// server suite mocks Prisma/bcrypt in server/test/setup.js).
vi.mock('../src/services/api', () => ({
  login: vi.fn()
}))

function renderLogin (user = null) {
  useAuth.mockReturnValue({ user })
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
    login.mockResolvedValue(undefined)
    user = await userEvent.setup()
  })

  it('renders the login form', () => {
    renderLogin()

    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('submits the entered credentials to the API', async () => {
    renderLogin()

    await user.type(screen.getByLabelText('Username'), 'testuser')
    await user.type(screen.getByLabelText('Password'), 'password')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(login).toHaveBeenCalledWith('testuser', 'password')
  })

  it('does not call the API when the form is empty', async () => {
    renderLogin()

    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(login).not.toHaveBeenCalled()
  })

  it('shows an error message when login fails', async () => {
    login.mockRejectedValue(new Error('Invalid credentials'))
    renderLogin()

    await user.type(screen.getByLabelText('Username'), 'testuser')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument()
  })

  it('redirects authenticated users to the users page', async () => {
    renderLogin({ id: 1, username: 'alice' })

    expect(await screen.findByText('Users page')).toBeInTheDocument()
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
  })
})
