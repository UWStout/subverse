import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThemeProvider } from '../src/context/ThemeContext'
import UserForm from '../src/components/UserForm'
import { checkAvailability, createUser, updateUser } from '../src/services/api'

// Mock the API layer so tests never touch the network.
vi.mock('../src/services/api', () => ({
  checkAvailability: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn()
}))

const EXISTING_USER = {
  id: 4,
  username: 'existing',
  first_name: 'Ex',
  last_name: 'Isting',
  email: 'ex@uni.edu',
  type: 'TEACHER'
}

function renderForm ({ open = true, user = null } = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn()
  render(
    <ThemeProvider>
      <UserForm open={open} user={user} onClose={onClose} onSubmit={onSubmit} />
    </ThemeProvider>
  )
  return { onClose, onSubmit }
}

let user

describe('UserForm', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    checkAvailability.mockResolvedValue({ available: true })
    createUser.mockResolvedValue({ user: EXISTING_USER })
    updateUser.mockResolvedValue(EXISTING_USER)
    user = await userEvent.setup()
  })

  it('renders nothing when closed', () => {
    renderForm({ open: false })

    expect(screen.queryByText('Create User')).not.toBeInTheDocument()
    expect(checkAvailability).not.toHaveBeenCalled()
  })

  it('shows the create title and defaults the type to STUDENT', async () => {
    renderForm({ open: true })

    expect(await screen.findByText('Create User')).toBeInTheDocument()
    // The Select displays its current value (STUDENT by default)
    expect(screen.getByText('STUDENT')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  it('shows validation errors when submitting an empty form', async () => {
    renderForm({ open: true })

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Username is required')).toBeInTheDocument()
    expect(screen.getByText('Email is required')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
    expect(checkAvailability).not.toHaveBeenCalled()
    expect(createUser).not.toHaveBeenCalled()
  })

  it('rejects an invalid email address', async () => {
    renderForm({ open: true })

    await user.type(screen.getByLabelText('Username'), 'newuser')
    await user.type(screen.getByLabelText('Email'), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), 'secret123')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Invalid email format')).toBeInTheDocument()
    expect(createUser).not.toHaveBeenCalled()
  })

  it('blocks creation when the username or email is already in use', async () => {
    checkAvailability.mockResolvedValue({ available: false, conflicts: ['username', 'email'] })

    renderForm({ open: true })

    await user.type(screen.getByLabelText('Username'), 'taken')
    await user.type(screen.getByLabelText('Email'), 'taken@uni.edu')
    await user.type(screen.getByLabelText('Password'), 'secret123')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Username already in use')).toBeInTheDocument()
    expect(screen.getByText('Email already in use')).toBeInTheDocument()
    expect(createUser).not.toHaveBeenCalled()
  })

  it('creates a user with the entered values', async () => {
    const { onClose, onSubmit } = renderForm({ open: true })

    await user.type(screen.getByLabelText('Username'), 'newuser')
    await user.type(screen.getByLabelText('First Name'), 'New')
    await user.type(screen.getByLabelText('Last Name'), 'User')
    await user.type(screen.getByLabelText('Email'), 'n@uni.edu')
    await user.type(screen.getByLabelText('Password'), 'secret123')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(checkAvailability).toHaveBeenCalledWith('newuser', 'n@uni.edu')
    expect(createUser).toHaveBeenCalledWith({
      username: 'newuser',
      email: 'n@uni.edu',
      password: 'secret123',
      type: 'STUDENT',
      firstName: 'New',
      lastName: 'User'
    })
    // Success notifies the page and closes the dialog
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('creates a user with a changed account type', async () => {
    renderForm({ open: true })

    await user.type(screen.getByLabelText('Username'), 'newadmin')
    await user.type(screen.getByLabelText('Email'), 'a@uni.edu')
    await user.type(screen.getByLabelText('Password'), 'secret123')

    // Change the type from the default STUDENT to ADMIN
    await user.click(screen.getByLabelText('Type'))
    await user.click(await screen.findByRole('option', { name: 'ADMIN' }))

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(createUser).toHaveBeenCalledWith({
      username: 'newadmin',
      email: 'a@uni.edu',
      password: 'secret123',
      type: 'ADMIN',
      firstName: '',
      lastName: ''
    })
  })

  it('shows the server error when creation fails', async () => {
    createUser.mockRejectedValue(new Error('An account with this username already exists'))

    renderForm({ open: true })

    await user.type(screen.getByLabelText('Username'), 'newuser')
    await user.type(screen.getByLabelText('Email'), 'n@uni.edu')
    await user.type(screen.getByLabelText('Password'), 'secret123')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText(/already exists/)).toBeInTheDocument()
    // Dialog stays open on failure
    expect(screen.getByText('Create User')).toBeInTheDocument()
  })

  it('prefills the fields when editing an existing user', async () => {
    renderForm({ open: true, user: EXISTING_USER })

    expect(await screen.findByText('Edit User')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toHaveValue('existing')
    expect(screen.getByLabelText('First Name')).toHaveValue('Ex')
    expect(screen.getByLabelText('Last Name')).toHaveValue('Isting')
    expect(screen.getByLabelText('Email')).toHaveValue('ex@uni.edu')
    // The Select shows the user's type; password starts blank
    expect(screen.getByText('TEACHER')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('updates an existing user with a blank password (keeps current)', async () => {
    const { onClose, onSubmit } = renderForm({ open: true, user: EXISTING_USER })

    await user.clear(screen.getByLabelText('Email'))
    await user.type(screen.getByLabelText('Email'), 'changed@uni.edu')

    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(updateUser).toHaveBeenCalledWith(4, {
      username: 'existing',
      email: 'changed@uni.edu',
      password: '',
      type: 'TEACHER',
      firstName: 'Ex',
      lastName: 'Isting'
    })
    // No availability check on update
    expect(checkAvailability).not.toHaveBeenCalled()
    // Success notifies the page and closes the dialog
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the server error when an update fails', async () => {
    updateUser.mockRejectedValue(new Error('An account with this email already exists'))

    renderForm({ open: true, user: EXISTING_USER })

    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByText(/already exists/)).toBeInTheDocument()
    expect(screen.getByText('Edit User')).toBeInTheDocument()
  })

  it('closes the dialog without submitting when cancelled', async () => {
    const { onClose, onSubmit } = renderForm({ open: true })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(createUser).not.toHaveBeenCalled()
  })
})
