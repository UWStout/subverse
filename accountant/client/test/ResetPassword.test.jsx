import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ResetPassword from '../src/pages/ResetPassword'
import { resetPassword } from '../src/services/api'

// Mock the API layer so tests never touch the network.
vi.mock('../src/services/api', () => ({
  resetPassword: vi.fn()
}))

function renderReset (path = '/reset-password') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path='/reset-password' element={<ResetPassword />} />
        <Route path='/login' element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ResetPassword page', () => {
  let user

  beforeEach(async () => {
    vi.clearAllMocks()
    resetPassword.mockResolvedValue({ message: 'Password has been reset successfully' })
    user = await userEvent.setup()
  })

  it('tells anonymous visitors that no link was provided', () => {
    renderReset()

    expect(screen.getByText(/no reset link was provided/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('shows the password form when a token is present', () => {
    renderReset('/reset-password?token=abc123')

    expect(screen.getByLabelText('New Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm New Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset Password' })).toBeInTheDocument()
  })

  it('resets the password with the token and offers sign-in', async () => {
    renderReset('/reset-password?token=abc123')

    await user.type(screen.getByLabelText('New Password'), 'new-secret-1')
    await user.type(screen.getByLabelText('Confirm New Password'), 'new-secret-1')
    await user.click(screen.getByRole('button', { name: 'Reset Password' }))

    expect(resetPassword).toHaveBeenCalledWith('abc123', 'new-secret-1')
    expect(await screen.findByText(/password has been reset successfully/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('rejects mismatched passwords without calling the API', async () => {
    renderReset('/reset-password?token=abc123')

    await user.type(screen.getByLabelText('New Password'), 'new-secret-1')
    await user.type(screen.getByLabelText('Confirm New Password'), 'different-2')
    await user.click(screen.getByRole('button', { name: 'Reset Password' }))

    expect(resetPassword).not.toHaveBeenCalled()
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
  })

  it('rejects an empty password without calling the API', async () => {
    renderReset('/reset-password?token=abc123')

    await user.click(screen.getByRole('button', { name: 'Reset Password' }))

    expect(resetPassword).not.toHaveBeenCalled()
    expect(await screen.findByText('Password is required')).toBeInTheDocument()
  })

  it('shows the server error for an invalid or expired token', async () => {
    resetPassword.mockRejectedValue(new Error('Reset token has expired. Request a new one.'))
    renderReset('/reset-password?token=old')

    await user.type(screen.getByLabelText('New Password'), 'new-secret-1')
    await user.type(screen.getByLabelText('Confirm New Password'), 'new-secret-1')
    await user.click(screen.getByRole('button', { name: 'Reset Password' }))

    expect(await screen.findByText(/expired/i)).toBeInTheDocument()
  })
})

describe('ResetPassword page - first-time setup (bulk-created accounts)', () => {
  let user

  beforeEach(async () => {
    vi.clearAllMocks()
    resetPassword.mockResolvedValue({ message: 'Password has been set' })
    user = await userEvent.setup()
  })

  it('shows set-password wording when first_time=true', () => {
    renderReset('/reset-password?token=abc123&first_time=true')

    expect(screen.getByText('Set Your Password')).toBeInTheDocument()
    expect(screen.getByText(/setting up your account for the first time/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set Password' })).toBeInTheDocument()
  })

  it('sets the password with the token and confirms in first-time wording', async () => {
    renderReset('/reset-password?token=abc123&first_time=true')

    await user.type(screen.getByLabelText('New Password'), 'new-secret-1')
    await user.type(screen.getByLabelText('Confirm New Password'), 'new-secret-1')
    await user.click(screen.getByRole('button', { name: 'Set Password' }))

    expect(resetPassword).toHaveBeenCalledWith('abc123', 'new-secret-1')
    expect(await screen.findByText(/password has been set/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('keeps reset wording when the param is absent', () => {
    renderReset('/reset-password?token=abc123')

    expect(screen.getByText('Reset Your Password')).toBeInTheDocument()
    expect(screen.queryByText(/first time/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset Password' })).toBeInTheDocument()
  })
})
