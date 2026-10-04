import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import PrivateRoute from '../src/components/PrivateRoute'
import { useAuth } from '../src/context/AuthContext'

// Mock the auth context - the guard only consumes the useAuth hook.
vi.mock('../src/context/AuthContext', () => ({
  useAuth: vi.fn()
}))

/** Render a protected route plus the /login fallback so redirects are observable. */
function renderProtected (auth) {
  useAuth.mockReturnValue(auth)
  return render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route path='/secret' element={<PrivateRoute />}>
          <Route index element={<div>Secret content</div>} />
        </Route>
        <Route path='/login' element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('PrivateRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading placeholder while the session is being verified', () => {
    renderProtected({ user: null, loading: true })

    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument()
  })

  it('redirects unauthenticated users to /login', () => {
    renderProtected({ user: null, loading: false })

    expect(screen.getByText('Login page')).toBeInTheDocument()
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument()
  })

  it('renders the protected outlet for authenticated users', () => {
    renderProtected({ user: { id: 1, username: 'alice' }, loading: false })

    expect(screen.getByText('Secret content')).toBeInTheDocument()
    expect(screen.queryByText('Login page')).not.toBeInTheDocument()
  })
})
