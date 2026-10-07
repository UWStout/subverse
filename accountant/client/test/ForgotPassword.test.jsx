import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ForgotPassword from '../src/pages/ForgotPassword'
import { requestPasswordReset } from '../src/services/api'

// Mock the API layer so tests never touch the network.
vi.mock('../src/services/api', () => ({
  requestPasswordReset: vi.fn()
}))

function renderForgot (path = '/forgot-password') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path='/forgot-password' element={<ForgotPassword />} />
        <Route path='/login' element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ForgotPassword page', () => {
  let user

  beforeEach(async () => {
    vi.clearAllMocks()
    requestPasswordReset.mockResolvedValue({ message: 'If an account matches that username or email, a password reset link has been sent' })
    user = await userEvent.setup()
  })

  it('renders the identifier form', () => {
    renderForgot()

    expect(screen.getByLabelText('Username or email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send Reset Link' })).toBeInTheDocument()
  })

  it('sends the trimmed identifier to the API and confirms', async () => {
    renderForgot()

    await user.type(screen.getByLabelText('Username or email'), ' alice@example.com ')
    await user.click(screen.getByRole('button', { name: 'Send Reset Link' }))

    expect(requestPasswordReset).toHaveBeenCalledWith('alice@example.com')
    expect(await screen.findByText(/password reset email has been sent/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('does not call the API when the field is empty', async () => {
    renderForgot()

    await user.click(screen.getByRole('button', { name: 'Send Reset Link' }))

    expect(requestPasswordReset).not.toHaveBeenCalled()
  })

  it('shows a server error when the request fails', async () => {
    requestPasswordReset.mockRejectedValue(new Error('Failed to process password reset request'))
    renderForgot()

    await user.type(screen.getByLabelText('Username or email'), 'alice')
    await user.click(screen.getByRole('button', { name: 'Send Reset Link' }))

    expect(await screen.findByText(/failed to process/i)).toBeInTheDocument()
  })
})
