import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider, useAuth } from '../src/context/AuthContext'
import { fetchCurrentUser, clearToken } from '../src/services/api'

// Mock the API layer so tests never touch the network.
vi.mock('../src/services/api', () => ({
  fetchCurrentUser: vi.fn(),
  clearToken: vi.fn()
}))

/** Test harness exposing every part of the auth context. */
function Harness () {
  const { user, loading, logout, protect } = useAuth()
  return (
    <div>
      <span data-testid='user'>{user ? user.username : 'none'}</span>
      <span data-testid='loading'>{String(loading)}</span>
      <button onClick={logout}>Log out</button>
      {protect(<div>Protected content</div>)}
    </div>
  )
}

function renderHarness () {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path='/' element={<AuthProvider><Harness /></AuthProvider>} />
        <Route path='/login' element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AuthContext', () => {
  let user

  beforeEach(async () => {
    vi.clearAllMocks()
    localStorage.clear()
    fetchCurrentUser.mockResolvedValue({ id: 1, username: 'alice' })
    user = await userEvent.setup()
  })

  it('restores the session from a valid stored token', async () => {
    renderHarness()

    expect(await screen.findByTestId('user')).toHaveTextContent('alice')
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
    // protect() passes content through once authenticated
    expect(screen.getByText('Protected content')).toBeInTheDocument()
  })

  it('clears the token and redirects to /login when the session is invalid', async () => {
    fetchCurrentUser.mockRejectedValue(new Error('Not logged in'))

    renderHarness()

    // protect() redirects unauthenticated users away from protected content
    expect(await screen.findByText('Login page')).toBeInTheDocument()
    expect(clearToken).toHaveBeenCalled()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('shows the loading placeholder while the session is being verified', () => {
    fetchCurrentUser.mockReturnValue(new Promise(() => {})) // never settles

    renderHarness()

    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('clears the token, signs out and redirects to /login on logout', async () => {
    renderHarness()
    await screen.findByTestId('user')

    await user.click(screen.getByRole('button', { name: 'Log out' }))

    expect(await screen.findByText('Login page')).toBeInTheDocument()
    expect(clearToken).toHaveBeenCalled()
  })
})
