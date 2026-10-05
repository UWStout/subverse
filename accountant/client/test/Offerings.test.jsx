import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../src/context/ThemeContext'
import Offerings from '../src/pages/Offerings'
import { useAuth } from '../src/context/AuthContext'
import {
  fetchOfferings,
  fetchOfferingTerms,
  deleteOffering,
  createOffering,
  updateOffering,
  fetchClasses,
  fetchTeachers
} from '../src/services/api'

// Mock the auth context - the page only consumes the useAuth hook.
vi.mock('../src/context/AuthContext', () => ({
  useAuth: vi.fn()
}))

// Mock the API layer so tests never touch the network.
vi.mock('../src/services/api', () => ({
  fetchOfferings: vi.fn(),
  fetchOfferingTerms: vi.fn(),
  deleteOffering: vi.fn(),
  createOffering: vi.fn(),
  updateOffering: vi.fn(),
  fetchClasses: vi.fn(),
  fetchTeachers: vi.fn()
}))

const TEACHER = { id: 1, username: 'prof', type: 'TEACHER' }
const STUDENT = { id: 2, username: 'student', type: 'STUDENT' }
const ADMIN = { id: 3, username: 'admin', type: 'ADMIN' }

// Plain offering row - the list API returns no joined class / teacher data.
const OFFERING_1 = {
  id: 1,
  class_id: 1,
  teacher_id: 1,
  term: 'FALL25',
  section: '101'
}

// Reference-list rows used by the page to map class_id / teacher_id → labels.
const CLASS_1 = { id: 1, subject: 'CS', number: '101', title: 'Intro CS' }
const TEACHER_ACCOUNT = { id: 1, username: 'prof', email: 'prof@uni.edu', type: 'TEACHER' }

const LIST_RESPONSE = { data: [OFFERING_1], total: 1, page: 1, limit: 25, totalPages: 1 }

/** Render the page inside a router so redirects can be observed. */
function renderPage (user) {
  useAuth.mockReturnValue({ user, loading: false, logout: vi.fn() })
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/offerings']}>
        <Routes>
          <Route path='/offerings' element={<Offerings />} />
          <Route path='/users' element={<div>Users page</div>} />
          <Route path='/login' element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('Offerings page', () => {
  let user

  beforeEach(async () => {
    vi.clearAllMocks()
    fetchOfferings.mockResolvedValue(LIST_RESPONSE)
    fetchOfferingTerms.mockResolvedValue(['FALL25', 'SPRING26'])
    deleteOffering.mockResolvedValue({ message: 'Offering deleted successfully' })
    createOffering.mockResolvedValue(OFFERING_1)
    updateOffering.mockResolvedValue(OFFERING_1)
    fetchClasses.mockResolvedValue({ data: [CLASS_1], total: 1, page: 1, limit: 100, totalPages: 1 })
    fetchTeachers.mockResolvedValue({ data: [TEACHER_ACCOUNT], total: 1, page: 1, limit: 100, totalPages: 1 })
    user = await userEvent.setup()
  })

  /* ---- Role gating ---- */

  it('redirects students to the users page', async () => {
    renderPage(STUDENT)

    expect(await screen.findByText('Users page')).toBeInTheDocument()
    expect(screen.queryByText('Class Offerings')).not.toBeInTheDocument()
    expect(fetchOfferings).not.toHaveBeenCalled()
  })

  it('allows admins to view the offerings page', async () => {
    renderPage(ADMIN)

    expect(await screen.findByText('Class Offerings')).toBeInTheDocument()
    expect(screen.queryByText('Users page')).not.toBeInTheDocument()
  })

  /* ---- Listing ---- */

  it('shows a loading indicator while data is being fetched', async () => {
    let resolveFetch
    fetchOfferings.mockReturnValue(new Promise(resolve => { resolveFetch = resolve }))

    renderPage(TEACHER)

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    resolveFetch({ ...LIST_RESPONSE, data: [], total: 0 })
    expect(await screen.findByText('No offerings found')).toBeInTheDocument()
  })

  it('renders offerings with class and teacher labels mapped from the reference lists', async () => {
    renderPage(TEACHER)

    expect(await screen.findByText('Class Offerings')).toBeInTheDocument()
    // Scope to the table: terms also appear in the filter chips
    const table = screen.getByRole('table')
    expect(within(table).getByText('CS 101')).toBeInTheDocument()
    expect(within(table).getByText('Intro CS')).toBeInTheDocument()
    expect(within(table).getByText('FALL25')).toBeInTheDocument()
    expect(within(table).getByText('prof')).toBeInTheDocument()
    // The reference lists are fetched once on mount (small, one page of 100)
    expect(fetchClasses).toHaveBeenCalledWith(1, 100)
    expect(fetchTeachers).toHaveBeenCalledWith(1, 100)
  })

  it('still renders the table when the reference lists fail', async () => {
    fetchClasses.mockRejectedValue(new Error('Failed to list classes'))
    fetchTeachers.mockRejectedValue(new Error('Failed to list teachers'))

    renderPage(TEACHER)

    // Offering data is present in the table even though the label maps are empty
    const table = screen.getByRole('table')
    expect(await within(table).findByText('FALL25')).toBeInTheDocument()
    expect(within(table).getByText('101')).toBeInTheDocument()
  })

  it('fetches the default page with no term filter', async () => {
    renderPage(TEACHER)

    await screen.findByText('Class Offerings')
    expect(fetchOfferings).toHaveBeenCalledWith('*', '*', '*', 1, 10)
  })

  it('shows the empty state when no offerings match', async () => {
    fetchOfferings.mockResolvedValue({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 })

    renderPage(TEACHER)

    expect(await screen.findByText('No offerings found')).toBeInTheDocument()
  })

  it('shows an error banner when the list request fails', async () => {
    fetchOfferings.mockRejectedValue(new Error('Failed to list offerings'))

    renderPage(TEACHER)

    const alert = await screen.findByText('Failed to list offerings')
    expect(alert).toBeInTheDocument()
    // Dismiss the banner
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Failed to list offerings')).not.toBeInTheDocument()
  })

  /* ---- Filtering ---- */

  it('renders term filter chips from the API (plus All)', async () => {
    renderPage(TEACHER)

    // MUI v9 renders clickable chips with role="button"
    expect(await screen.findByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'FALL25' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SPRING26' })).toBeInTheDocument()
  })

  it('refetches with the selected term when a chip is clicked', async () => {
    renderPage(TEACHER)
    await screen.findByText('Class Offerings')

    await user.click(screen.getByRole('button', { name: 'SPRING26' }))

    expect(fetchOfferings).toHaveBeenCalledWith('SPRING26', '*', '*', 1, 10)
  })

  /* ---- Pagination ---- */

  it('fetches the next page via the pagination control', async () => {
    fetchOfferings.mockResolvedValue({ data: [OFFERING_1], total: 25, page: 1, limit: 10, totalPages: 3 })

    renderPage(TEACHER)
    await screen.findByText('Class Offerings')

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))

    expect(fetchOfferings).toHaveBeenCalledWith('*', '*', '*', 2, 10)
  })

  it('refetches from page 1 when the rows-per-page size changes', async () => {
    renderPage(TEACHER)
    await screen.findByText('Class Offerings')

    // MUI v9 labels the rows-per-page select "Rows per page:" (colon, not period)
    await user.click(screen.getByLabelText('Rows per page:'))
    await user.click(await screen.findByRole('option', { name: '5' }))

    expect(fetchOfferings).toHaveBeenCalledWith('*', '*', '*', 1, 5)
  })

  /* ---- Create / Edit modals ---- */

  it('opens the create modal from the Add Offering button', async () => {
    renderPage(TEACHER)
    await screen.findByText('Class Offerings')

    await user.click(screen.getByRole('button', { name: 'Add Offering' }))

    expect(await screen.findByText('Create Offering')).toBeInTheDocument()
  })

  it('opens the edit modal for a row', async () => {
    renderPage(TEACHER)
    await screen.findByText('Class Offerings')

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(await screen.findByText('Edit Offering')).toBeInTheDocument()
  })

  /* ---- Delete flow ---- */

  it('deletes an offering after confirmation and reloads the list', async () => {
    renderPage(TEACHER)
    await screen.findByText('Class Offerings')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/CS 101/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(deleteOffering).toHaveBeenCalledWith(1)
    // The list is reloaded after the delete
    expect(fetchOfferings).toHaveBeenCalledTimes(2)
  })

  it('does not delete when the confirmation is cancelled', async () => {
    renderPage(TEACHER)
    await screen.findByText('Class Offerings')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(deleteOffering).not.toHaveBeenCalled()
  })

  it('shows an error banner when the delete request fails', async () => {
    deleteOffering.mockRejectedValue(new Error('Failed to delete offering'))

    renderPage(TEACHER)
    await screen.findByText('Class Offerings')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Failed to delete offering')).toBeInTheDocument()
  })

  it('steps back one page when the last row on a later page is deleted', async () => {
    // Three pages of data; navigate to page 2 which holds a single offering
    fetchOfferings.mockResolvedValue({ data: [OFFERING_1], total: 25, page: 2, limit: 10, totalPages: 3 })

    renderPage(TEACHER)
    await screen.findByText('Class Offerings')

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    await screen.findAllByText('CS 101') // wait for the page-2 reload

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(deleteOffering).toHaveBeenCalledWith(1)
    // Deleting the only row on page 2 steps back to page 1 (refetches it)
    expect(fetchOfferings).toHaveBeenLastCalledWith('*', '*', '*', 1, 10)
  })

  it('closes the create modal when cancelled', async () => {
    renderPage(TEACHER)
    await screen.findByText('Class Offerings')

    await user.click(screen.getByRole('button', { name: 'Add Offering' }))
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    // The dialog closes (after its exit transition) and the page remains
    await waitFor(() => expect(screen.queryByText('Create Offering')).not.toBeInTheDocument())
  })
})
