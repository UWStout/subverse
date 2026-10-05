import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../src/context/ThemeContext'
import Projects from '../src/pages/Projects'
import { useAuth } from '../src/context/AuthContext'
import {
  fetchProjects,
  deleteProject,
  createProject,
  updateProject,
  fetchOfferingTerms,
  fetchClasses,
  fetchOfferings
} from '../src/services/api'

// Mock the auth context - the page only consumes the useAuth hook.
vi.mock('../src/context/AuthContext', () => ({
  useAuth: vi.fn()
}))

// Mock the API layer so tests never touch the network.
vi.mock('../src/services/api', () => ({
  fetchProjects: vi.fn(),
  deleteProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  fetchOfferingTerms: vi.fn(),
  fetchClasses: vi.fn(),
  fetchOfferings: vi.fn()
}))

const TEACHER = { id: 1, username: 'prof', type: 'TEACHER' }
const STUDENT = { id: 2, username: 'student', type: 'STUDENT' }
const ADMIN = { id: 3, username: 'admin', type: 'ADMIN' }

// Plain project row - the list API returns no joined offering / class data.
const PROJECT_1 = {
  id: 1,
  offering_id: 1,
  title: 'Final Project',
  slug: 'final-project',
  subversion_url: null,
  git_url: 'https://github.com/example/final-project.git',
  description: 'Complete final assignment for the course'
}

// Reference-list rows used by the page to map offering_id / class_id → labels.
const CLASS_1 = { id: 1, subject: 'CS', number: '101', title: 'Intro CS' }
const OFFERING_1 = { id: 1, class_id: 1, teacher_id: 1, term: 'FALL25', section: '101' }

const LIST_RESPONSE = { data: [PROJECT_1], total: 1, page: 1, limit: 25, totalPages: 1 }

/** Render the page inside a router so redirects can be observed. */
function renderPage (user) {
  useAuth.mockReturnValue({ user, loading: false, logout: vi.fn() })
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path='/projects' element={<Projects />} />
          <Route path='/users' element={<div>Users page</div>} />
          <Route path='/login' element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

/** The list API needs at least one concrete filter; select the CS-101 chip. */
async function selectClassFilter (user) {
  await user.click(screen.getByRole('button', { name: 'CS 101' }))
  return screen.findAllByText('Final Project')
}

describe('Projects page', () => {
  let user

  beforeEach(async () => {
    vi.clearAllMocks()
    fetchProjects.mockResolvedValue(LIST_RESPONSE)
    fetchOfferingTerms.mockResolvedValue(['FALL25', 'SPRING26'])
    deleteProject.mockResolvedValue({ message: 'Project deleted successfully' })
    createProject.mockResolvedValue(PROJECT_1)
    updateProject.mockResolvedValue(PROJECT_1)
    fetchClasses.mockResolvedValue({ data: [CLASS_1], total: 1, page: 1, limit: 100, totalPages: 1 })
    fetchOfferings.mockResolvedValue({ data: [OFFERING_1], total: 1, page: 1, limit: 100, totalPages: 1 })
    user = await userEvent.setup()
  })

  /* ---- Default state (no filter selected) ---- */

  it('shows a hint and fetches nothing when no filter is selected', async () => {
    renderPage(ADMIN)

    expect(await screen.findByText(/select a class or a term/i)).toBeInTheDocument()
    expect(fetchProjects).not.toHaveBeenCalled()
  })

  /* ---- Role-based interface ---- */

  it('hides the add button and row actions from students', async () => {
    renderPage(STUDENT)

    expect(await screen.findByText('Class Projects')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Project' })).not.toBeInTheDocument()

    // Select a filter so rows render, then check for the absence of actions
    await selectClassFilter(user)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('shows the add button and row actions to teachers', async () => {
    renderPage(TEACHER)

    expect(await screen.findByText('Class Projects')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Project' })).toBeInTheDocument()

    await selectClassFilter(user)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('shows the add button and row actions to admins', async () => {
    renderPage(ADMIN)

    expect(await screen.findByText('Class Projects')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Project' })).toBeInTheDocument()

    await selectClassFilter(user)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  /* ---- Filtering ---- */

  it('renders class and term filter chips from the API (plus All)', async () => {
    renderPage(ADMIN)

    await screen.findByText('Class Projects')
    // Both chip rows offer an "All" option plus the loaded values
    expect(screen.getAllByRole('button', { name: 'All' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'CS 101' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'FALL25' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SPRING26' })).toBeInTheDocument()
  })

  it('fetches projects when a class chip is selected', async () => {
    renderPage(ADMIN)
    await screen.findByText('Class Projects')

    await user.click(screen.getByRole('button', { name: 'CS 101' }))

    expect(fetchProjects).toHaveBeenCalledWith('CS-101', '*', 1, 10)
  })

  it('fetches projects when a term chip is selected', async () => {
    renderPage(ADMIN)
    await screen.findByText('Class Projects')

    await user.click(screen.getByRole('button', { name: 'FALL25' }))

    expect(fetchProjects).toHaveBeenCalledWith('*', 'FALL25', 1, 10)
  })

  it('fetches with both filters when a class and a term are selected', async () => {
    renderPage(ADMIN)
    await screen.findByText('Class Projects')

    await user.click(screen.getByRole('button', { name: 'CS 101' }))
    await user.click(screen.getByRole('button', { name: 'SPRING26' }))

    expect(fetchProjects).toHaveBeenLastCalledWith('CS-101', 'SPRING26', 1, 10)
  })

  it('renders projects with class and term labels mapped from the reference lists', async () => {
    renderPage(ADMIN)

    await screen.findByText('Class Projects')
    await selectClassFilter(user)

    // Scope to the table: terms also appear in the filter chips
    const table = screen.getByRole('table')
    expect(within(table).getByText('Final Project')).toBeInTheDocument()
    expect(within(table).getByText('CS 101')).toBeInTheDocument()
    expect(within(table).getByText('FALL25')).toBeInTheDocument()
    expect(within(table).getByText('https://github.com/example/final-project.git')).toBeInTheDocument()
    // The reference lists are fetched once on mount (small, one page of 100)
    expect(fetchClasses).toHaveBeenCalledWith(1, 100)
    expect(fetchOfferings).toHaveBeenCalledWith('*', '*', '*', 1, 100)
  })

  it('still renders the table when the reference lists fail', async () => {
    fetchClasses.mockRejectedValue(new Error('Failed to list classes'))
    fetchOfferings.mockRejectedValue(new Error('Failed to list offerings'))

    renderPage(ADMIN)

    await screen.findByText('Class Projects')
    // The class chips are gone (their source failed), but the term chips work
    await user.click(screen.getByRole('button', { name: 'FALL25' }))

    // Project data is present in the table even though the label maps are empty
    const table = screen.getByRole('table')
    expect(await within(table).findByText('Final Project')).toBeInTheDocument()
  })

  it('shows the empty state when no projects match', async () => {
    fetchProjects.mockResolvedValue({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 })

    renderPage(ADMIN)
    await screen.findByText('Class Projects')

    await user.click(screen.getByRole('button', { name: 'CS 101' }))

    expect(await screen.findByText('No projects found')).toBeInTheDocument()
  })

  it('shows an error banner when the list request fails', async () => {
    fetchProjects.mockRejectedValue(new Error('Failed to list projects'))

    renderPage(ADMIN)
    await screen.findByText('Class Projects')

    await user.click(screen.getByRole('button', { name: 'CS 101' }))

    const alert = await screen.findByText('Failed to list projects')
    expect(alert).toBeInTheDocument()
    // Dismiss the banner
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Failed to list projects')).not.toBeInTheDocument()
  })

  /* ---- Pagination ---- */

  it('fetches the next page via the pagination control', async () => {
    fetchProjects.mockResolvedValue({ data: [PROJECT_1], total: 25, page: 1, limit: 10, totalPages: 3 })

    renderPage(ADMIN)
    await screen.findByText('Class Projects')
    await user.click(screen.getByRole('button', { name: 'CS 101' }))
    await screen.findAllByText('Final Project') // wait for the filtered load

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))

    expect(fetchProjects).toHaveBeenLastCalledWith('CS-101', '*', 2, 10)
  })

  it('refetches from page 1 when the rows-per-page size changes', async () => {
    renderPage(ADMIN)
    await screen.findByText('Class Projects')
    await user.click(screen.getByRole('button', { name: 'CS 101' }))
    await screen.findAllByText('Final Project')

    // MUI v9 labels the rows-per-page select "Rows per page:" (colon, not period)
    await user.click(screen.getByLabelText('Rows per page:'))
    await user.click(await screen.findByRole('option', { name: '5' }))

    expect(fetchProjects).toHaveBeenLastCalledWith('CS-101', '*', 1, 5)
  })

  /* ---- Create / Edit modals ---- */

  it('opens the create modal from the Add Project button', async () => {
    renderPage(ADMIN)
    await screen.findByText('Class Projects')

    await user.click(screen.getByRole('button', { name: 'Add Project' }))

    expect(await screen.findByText('Create Project')).toBeInTheDocument()
  })

  it('opens the edit modal for a row', async () => {
    renderPage(TEACHER)
    await screen.findByText('Class Projects')
    await selectClassFilter(user)

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(await screen.findByText('Edit Project')).toBeInTheDocument()
  })

  it('closes the create modal when cancelled', async () => {
    renderPage(ADMIN)
    await screen.findByText('Class Projects')

    await user.click(screen.getByRole('button', { name: 'Add Project' }))
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    // The dialog closes (after its exit transition) and the page remains
    await waitFor(() => expect(screen.queryByText('Create Project')).not.toBeInTheDocument())
  })

  /* ---- Delete flow ---- */

  it('deletes a project after confirmation and reloads the list', async () => {
    renderPage(ADMIN)
    await screen.findByText('Class Projects')
    await selectClassFilter(user)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Final Project/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(deleteProject).toHaveBeenCalledWith(1)
    // The list is reloaded after the delete
    expect(fetchProjects).toHaveBeenCalledTimes(2)
  })

  it('does not delete when the confirmation is cancelled', async () => {
    renderPage(ADMIN)
    await screen.findByText('Class Projects')
    await selectClassFilter(user)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(deleteProject).not.toHaveBeenCalled()
  })

  it('shows an error banner when the delete request fails', async () => {
    deleteProject.mockRejectedValue(new Error('Teachers can only delete projects in classes they teach'))

    renderPage(TEACHER)
    await screen.findByText('Class Projects')
    await selectClassFilter(user)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText(/only delete projects in classes they teach/i)).toBeInTheDocument()
  })

  it('steps back one page when the last row on a later page is deleted', async () => {
    // Three pages of data; navigate to page 2 which holds a single project
    fetchProjects.mockResolvedValue({ data: [PROJECT_1], total: 25, page: 2, limit: 10, totalPages: 3 })

    renderPage(ADMIN)
    await screen.findByText('Class Projects')
    await user.click(screen.getByRole('button', { name: 'CS 101' }))
    await screen.findAllByText('Final Project') // wait for the filtered load

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    await screen.findAllByText('Final Project') // wait for the page-2 reload

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(deleteProject).toHaveBeenCalledWith(1)
    // Deleting the only row on page 2 steps back to page 1 (refetches it)
    expect(fetchProjects).toHaveBeenLastCalledWith('CS-101', '*', 1, 10)
  })
})
