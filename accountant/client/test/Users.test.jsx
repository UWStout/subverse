import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../src/context/ThemeContext'
import Users from '../src/pages/Users'
import { useAuth } from '../src/context/AuthContext'
import { fetchUsers, deleteUser, checkAvailability, createUser } from '../src/services/api'

// Mock the auth context — the page only consumes the useAuth hook.
vi.mock('../src/context/AuthContext', () => ({
  useAuth: vi.fn()
}))

// Mock the API layer so tests never touch the network.
vi.mock('../src/services/api', () => ({
  fetchUsers: vi.fn(),
  deleteUser: vi.fn(),
  checkAvailability: vi.fn(),
  createUser: vi.fn()
}))

const USER_1 = {
  id: 1,
  username: 'alice',
  first_name: 'Alice',
  last_name: 'Smith',
  email: 'alice@uni.edu',
  type: 'STUDENT'
}

const LIST_RESPONSE = { data: [USER_1], total: 1, page: 1, limit: 25, totalPages: 1 }

/** Render the page with a given auth user (protect passes content through). */
function renderPage (user) {
  useAuth.mockReturnValue({
    user,
    loading: false,
    logout: vi.fn(),
    protect: el => el
  })
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/users']}>
        <Routes>
          <Route path='/users' element={<Users />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('Users page', () => {
  let user

  beforeEach(async () => {
    vi.clearAllMocks()
    fetchUsers.mockResolvedValue(LIST_RESPONSE)
    deleteUser.mockResolvedValue({ message: 'User deleted successfully' })
    checkAvailability.mockResolvedValue({ available: true })
    createUser.mockResolvedValue({ user: { id: 2 } })
    user = await userEvent.setup()
  })

  /* ---- Auth protection ---- */

  it('renders nothing when protect() rejects the content', () => {
    useAuth.mockReturnValue({
      user: USER_1,
      loading: false,
      logout: vi.fn(),
      protect: () => null
    })
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/users']}>
          <Routes>
            <Route path='/users' element={<Users />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    )

    expect(screen.queryByText('User Accounts')).not.toBeInTheDocument()
    expect(fetchUsers).not.toHaveBeenCalled()
  })

  /* ---- Listing ---- */

  it('shows a loading indicator while data is being fetched', async () => {
    let resolveFetch
    fetchUsers.mockReturnValue(new Promise(resolve => { resolveFetch = resolve }))

    renderPage(USER_1)

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    resolveFetch({ ...LIST_RESPONSE, data: [], total: 0 })
    expect(await screen.findByText('No users found')).toBeInTheDocument()
  })

  it('renders users with their type chip', async () => {
    renderPage(USER_1)

    expect(await screen.findByText('User Accounts')).toBeInTheDocument()
    // Scope to the table: type names also appear in the filter chips
    const table = screen.getByRole('table')
    expect(within(table).getByText('alice')).toBeInTheDocument()
    expect(within(table).getByText('Alice')).toBeInTheDocument()
    expect(within(table).getByText('Smith')).toBeInTheDocument()
    expect(within(table).getByText('alice@uni.edu')).toBeInTheDocument()
    expect(within(table).getByText('STUDENT')).toBeInTheDocument()
  })

  it('fetches the default page with no type filter', async () => {
    renderPage(USER_1)

    await screen.findByText('User Accounts')
    expect(fetchUsers).toHaveBeenCalledWith('*', 1, 10)
  })

  it('shows the empty state when no users match', async () => {
    fetchUsers.mockResolvedValue({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 })

    renderPage(USER_1)

    expect(await screen.findByText('No users found')).toBeInTheDocument()
  })

  it('shows an error banner when the list request fails', async () => {
    fetchUsers.mockRejectedValue(new Error('Failed to list users'))

    renderPage(USER_1)

    const alert = await screen.findByText('Failed to list users')
    expect(alert).toBeInTheDocument()
    // Dismiss the banner
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Failed to list users')).not.toBeInTheDocument()
  })

  /* ---- Filtering ---- */

  it('renders type filter chips (All + each account type)', async () => {
    renderPage(USER_1)

    // MUI v9 renders clickable chips with role="button"
    expect(await screen.findByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'STUDENT' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'TEACHER' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ADMIN' })).toBeInTheDocument()
  })

  it('refetches with the selected type when a chip is clicked', async () => {
    renderPage(USER_1)
    await screen.findByText('User Accounts')

    await user.click(screen.getByRole('button', { name: 'TEACHER' }))

    expect(fetchUsers).toHaveBeenCalledWith('TEACHER', 1, 10)
  })

  /* ---- Pagination ---- */

  it('fetches the next page via the pagination control', async () => {
    fetchUsers.mockResolvedValue({ data: [USER_1], total: 25, page: 1, limit: 10, totalPages: 3 })

    renderPage(USER_1)
    await screen.findByText('User Accounts')

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))

    expect(fetchUsers).toHaveBeenCalledWith('*', 2, 10)
  })

  it('refetches from page 1 when the rows-per-page size changes', async () => {
    renderPage(USER_1)
    await screen.findByText('User Accounts')

    // MUI v9 labels the rows-per-page select "Rows per page:" (colon, not period)
    await user.click(screen.getByLabelText('Rows per page:'))
    await user.click(await screen.findByRole('option', { name: '5' }))

    expect(fetchUsers).toHaveBeenCalledWith('*', 1, 5)
  })

  /* ---- Create / Edit modals ---- */

  it('opens the create modal from the Add User button', async () => {
    renderPage(USER_1)
    await screen.findByText('User Accounts')

    await user.click(screen.getByRole('button', { name: 'Add User' }))

    expect(await screen.findByText('Create User')).toBeInTheDocument()
  })

  it('opens the edit modal for a row', async () => {
    renderPage(USER_1)
    await screen.findByText('User Accounts')

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(await screen.findByText('Edit User')).toBeInTheDocument()
  })

  it('shows an error banner when the delete request fails', async () => {
    deleteUser.mockRejectedValue(new Error('Cannot delete yourself'))

    renderPage(USER_1)
    await screen.findByText('User Accounts')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Cannot delete yourself')).toBeInTheDocument()
  })

  it('creates a user via the modal, closes it and reloads the list', async () => {
    renderPage(USER_1)
    await screen.findByText('User Accounts')

    await user.click(screen.getByRole('button', { name: 'Add User' }))
    await screen.findByText('Create User')

    await user.type(screen.getByLabelText('Username'), 'newuser')
    await user.type(screen.getByLabelText('Email'), 'n@uni.edu')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(createUser).toHaveBeenCalledWith({
      username: 'newuser',
      email: 'n@uni.edu',
      password: 'secret123',
      type: 'STUDENT',
      firstName: '',
      lastName: ''
    })
    // The list is reloaded after the create and the dialog closes
    await waitFor(() => expect(fetchUsers).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Create User')).not.toBeInTheDocument())
  })

  /* ---- Delete flow ---- */

  it('deletes a user after confirmation and reloads the list', async () => {
    renderPage(USER_1)
    await screen.findByText('User Accounts')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('alice')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(deleteUser).toHaveBeenCalledWith(1)
    // The list is reloaded after the delete
    expect(fetchUsers).toHaveBeenCalledTimes(2)
  })

  it('does not delete when the confirmation is cancelled', async () => {
    renderPage(USER_1)
    await screen.findByText('User Accounts')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('steps back one page when the last row on a later page is deleted', async () => {
    // Two pages of data; navigate to page 2 which holds a single user
    fetchUsers.mockResolvedValue({ data: [USER_1], total: 15, page: 2, limit: 10, totalPages: 2 })

    renderPage(USER_1)
    await screen.findByText('User Accounts')

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    await screen.findAllByText('alice') // wait for the page-2 reload

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(deleteUser).toHaveBeenCalledWith(1)
    // Deleting the only row on page 2 steps back to page 1 (refetches it)
    expect(fetchUsers).toHaveBeenLastCalledWith('*', 1, 10)
  })
})
