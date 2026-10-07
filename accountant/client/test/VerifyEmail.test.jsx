import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import VerifyEmail from '../src/pages/VerifyEmail'
import { useAuth } from '../src/context/AuthContext'
import { verifyEmail, resendVerification, fetchCurrentUser } from '../src/services/api'

// Mock the auth context - the page only consumes the useAuth hook.
vi.mock('../src/context/AuthContext', () => ({
  useAuth: vi.fn()
}))

// Mock the API layer so tests never touch the network; isEmailVerified is a
// pure helper, so the real implementation is inlined into the mock.
vi.mock('../src/services/api', () => ({
  verifyEmail: vi.fn(),
  resendVerification: vi.fn(),
  fetchCurrentUser: vi.fn(),
  isEmailVerified: (user) => !!user && user.verification_sent_at == null
}))

const UNVERIFIED = {
  id: 1,
  username: 'alice',
  email: 'alice@example.com',
  verification_sent_at: '2026-10-07T00:00:00Z'
}
const VERIFIED = { ...UNVERIFIED, verification_sent_at: null }

let setUser

function renderVerify (authUser = null, path = '/verify') {
  useAuth.mockReturnValue({ user: authUser, loading: false, setUser })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path='/verify' element={<VerifyEmail />} />
        <Route path='/login' element={<div>Login page</div>} />
        <Route path='/users' element={<div>Users page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('VerifyEmail page', () => {
  let user

  beforeEach(async () => {
    vi.clearAllMocks()
    setUser = vi.fn()
    verifyEmail.mockResolvedValue({ message: 'Email address verified successfully' })
    resendVerification.mockResolvedValue({ message: 'Verification email sent' })
    fetchCurrentUser.mockResolvedValue(VERIFIED)
    user = await userEvent.setup()
  })

  /* ---- Without a token (redirect target for unverified sessions) ---- */

  it('tells anonymous visitors that no link was provided', () => {
    renderVerify(null)

    expect(screen.getByText(/no verification link was provided/i)).toBeInTheDocument()
    // The Sign In control is a navigation link (MUI Button with component={Link})
    expect(screen.getByRole('link', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('offers a resend to a logged-in user with an unverified address', async () => {
    renderVerify(UNVERIFIED)

    expect(await screen.findByText(/verification email has been sent to/i)).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resend Verification Email' }))

    expect(resendVerification).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/new verification email has been sent/i)).toBeInTheDocument()
  })

  it('shows a server error when the resend fails', async () => {
    resendVerification.mockRejectedValue(new Error('Failed to send verification email. Try again later.'))
    renderVerify(UNVERIFIED)

    await user.click(await screen.findByRole('button', { name: 'Resend Verification Email' }))

    expect(await screen.findByText(/try again later/i)).toBeInTheDocument()
  })

  it('points a verified user back into the app', async () => {
    renderVerify(VERIFIED)

    expect(await screen.findByText(/already verified/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Users' })).toBeInTheDocument()
  })

  /* ---- With a token (the emailed link) ---- */

  it('verifies the token on load and offers sign-in', async () => {
    renderVerify(null, '/verify?token=abc123')

    expect(await screen.findByText(/verified successfully/i)).toBeInTheDocument()
    expect(verifyEmail).toHaveBeenCalledWith('abc123')
    expect(screen.getByRole('link', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('refreshes the session when a logged-in user verifies their own address', async () => {
    renderVerify(UNVERIFIED, '/verify?token=abc123')

    await screen.findByText(/verified successfully/i)

    expect(fetchCurrentUser).toHaveBeenCalledTimes(1)
    expect(setUser).toHaveBeenCalledWith(VERIFIED)
  })

  it('shows the server error for an invalid token', async () => {
    verifyEmail.mockRejectedValue(new Error('Invalid verification token'))
    renderVerify(null, '/verify?token=bad')

    expect(await screen.findByText('Invalid verification token')).toBeInTheDocument()
  })

  it('exchanges the token only once when StrictMode double-invokes effects', async () => {
    // Mimic the server's single-use token: the first call succeeds and
    // consumes the token, any later call is rejected. Under StrictMode the
    // effect runs twice; a second request would surface a false "Invalid
    // verification token" error even though verification had succeeded.
    let calls = 0
    verifyEmail.mockImplementation(() => {
      calls += 1
      return calls === 1
        ? Promise.resolve({ message: 'Email address verified successfully' })
        : Promise.reject(new Error('Invalid verification token'))
    })

    render(
      <React.StrictMode>
        <MemoryRouter initialEntries={['/verify?token=abc123']}>
          <Routes>
            <Route path='/verify' element={<VerifyEmail />} />
            <Route path='/login' element={<div>Login page</div>} />
            <Route path='/users' element={<div>Users page</div>} />
          </Routes>
        </MemoryRouter>
      </React.StrictMode>
    )

    expect(verifyEmail).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/verified successfully/i)).toBeInTheDocument()
    expect(screen.queryByText('Invalid verification token')).not.toBeInTheDocument()
  })

  it('offers a resend when the token expired and the user is logged in', async () => {
    verifyEmail.mockRejectedValue(new Error('Verification token has expired. Request a new one.'))
    renderVerify(UNVERIFIED, '/verify?token=old')

    expect(await screen.findByText(/expired/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend Verification Email' })).toBeInTheDocument()
  })
})
