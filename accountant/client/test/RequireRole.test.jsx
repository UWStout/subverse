import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RequireRole from '../src/components/RequireRole'
import { useAuth } from '../src/context/AuthContext'

// Mock the auth context - the guard only consumes the useAuth hook.
vi.mock('../src/context/AuthContext', () => ({
  useAuth: vi.fn()
}))

const TEACHER = { id: 1, username: 'prof', type: 'TEACHER' }
const STUDENT = { id: 2, username: 'student', type: 'STUDENT' }
const ADMIN = { id: 3, username: 'admin', type: 'ADMIN' }

/** Render a role-gated route plus /login, /users and /projects fallbacks. */
function renderGated (auth) {
  useAuth.mockReturnValue(auth)
  return render(
    <MemoryRouter initialEntries={['/gated']}>
      <Routes>
        <Route path='/gated' element={<RequireRole roles={['TEACHER']}><div>Gated content</div></RequireRole>} />
        <Route path='/users' element={<div>Users page</div>} />
        <Route path='/projects' element={<div>Projects page</div>} />
        <Route path='/login' element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RequireRole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading placeholder while the session is being verified', () => {
    renderGated({ user: null, loading: true })

    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('Gated content')).not.toBeInTheDocument()
  })

  it('redirects unauthenticated users to /login', () => {
    renderGated({ user: null, loading: false })

    expect(screen.getByText('Login page')).toBeInTheDocument()
    expect(screen.queryByText('Gated content')).not.toBeInTheDocument()
  })

  it('redirects authenticated non-student users without an allowed role to /users', () => {
    renderGated({ user: ADMIN, loading: false })

    expect(screen.getByText('Users page')).toBeInTheDocument()
    expect(screen.queryByText('Gated content')).not.toBeInTheDocument()
  })

  it('redirects students without an allowed role to /projects (their home)', () => {
    renderGated({ user: STUDENT, loading: false })

    expect(screen.getByText('Projects page')).toBeInTheDocument()
    expect(screen.queryByText('Users page')).not.toBeInTheDocument()
    expect(screen.queryByText('Gated content')).not.toBeInTheDocument()
  })

  it('renders the children for users with an allowed role', () => {
    renderGated({ user: TEACHER, loading: false })

    expect(screen.getByText('Gated content')).toBeInTheDocument()
    expect(screen.queryByText('Users page')).not.toBeInTheDocument()
  })
})
