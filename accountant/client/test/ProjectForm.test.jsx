import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThemeProvider } from '../src/context/ThemeContext'
import ProjectForm from '../src/components/ProjectForm'
import {
  createProject,
  updateProject,
  fetchOfferings,
  fetchClasses
} from '../src/services/api'

// Mock the API layer so tests never touch the network.
vi.mock('../src/services/api', () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  fetchOfferings: vi.fn(),
  fetchClasses: vi.fn()
}))

const CLASSES = [
  { id: 1, subject: 'CS', number: '101', title: 'Intro CS' },
  { id: 2, subject: 'MATH', number: '201', title: 'Calculus I' }
]
const OFFERINGS = [
  { id: 1, class_id: 1, teacher_id: 1, term: 'FALL2025', section: 'A' },
  { id: 2, class_id: 2, teacher_id: 1, term: 'SPRING2026', section: 'B' }
]

const PROJECT_1 = {
  id: 1,
  offering_id: 1,
  title: 'Final Project',
  slug: 'final-project',
  subversion_url: null,
  git_url: 'https://github.com/example/final-project.git',
  description: 'Complete final assignment for the course'
}

function renderForm ({ open = true, project = null } = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn()
  render(
    <ThemeProvider>
      <ProjectForm open={open} project={project} onClose={onClose} onSubmit={onSubmit} />
    </ThemeProvider>
  )
  return { onClose, onSubmit }
}

let user

/** Wait until the offering option list has finished loading. */
async function waitOptionsLoaded () {
  await waitFor(() => {
    expect(screen.queryByText(/Loading offerings/)).not.toBeInTheDocument()
  })
}

/**
 * Open a MUI Select (rendered as a combobox div in MUI v9) and click the
 * option whose label matches `optionName`.
 */
async function selectOption (label, optionName) {
  await user.click(screen.getByLabelText(label))
  await user.click(await screen.findByRole('option', { name: optionName }))
}

describe('ProjectForm', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    fetchOfferings.mockResolvedValue({ data: OFFERINGS, total: 2, page: 1, limit: 100, totalPages: 1 })
    fetchClasses.mockResolvedValue({ data: CLASSES, total: 2, page: 1, limit: 100, totalPages: 1 })
    createProject.mockResolvedValue(PROJECT_1)
    updateProject.mockResolvedValue(PROJECT_1)
    user = await userEvent.setup()
  })

  it('renders nothing and loads no options when closed', () => {
    renderForm({ open: false })

    expect(screen.queryByText('Create Project')).not.toBeInTheDocument()
    expect(fetchOfferings).not.toHaveBeenCalled()
    expect(fetchClasses).not.toHaveBeenCalled()
  })

  it('loads offering options with class labels when opened in create mode', async () => {
    renderForm({ open: true })

    expect(await screen.findByText('Create Project')).toBeInTheDocument()
    await waitOptionsLoaded()

    // Open the offering listbox and check its options
    await user.click(screen.getByLabelText('Offering'))
    expect(await screen.findByRole('option', { name: 'CS 101 – FALL2025 A' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'MATH 201 – SPRING2026 B' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    expect(fetchOfferings).toHaveBeenCalledWith('*', '*', '*', 1, 100)
    expect(fetchClasses).toHaveBeenCalledWith(1, 100)
  })

  it('shows validation errors when submitting an empty form', async () => {
    renderForm({ open: true })
    // Wait for the option lists so the Create button is enabled
    await waitOptionsLoaded()

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Offering is required')).toBeInTheDocument()
    expect(screen.getByText('Title is required')).toBeInTheDocument()
    expect(screen.getByText('Slug is required')).toBeInTheDocument()
    expect(createProject).not.toHaveBeenCalled()
  })

  it('rejects slugs that do not match the server format', async () => {
    renderForm({ open: true })
    await waitOptionsLoaded()

    await selectOption('Offering', 'CS 101 – FALL2025 A')
    await user.type(screen.getByLabelText('Title'), 'Final Project')
    await user.type(screen.getByLabelText('Slug'), 'Bad Slug')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText(/invalid slug/i)).toBeInTheDocument()
    expect(createProject).not.toHaveBeenCalled()
  })

  it('creates a project with the selected values', async () => {
    const { onClose, onSubmit } = renderForm({ open: true })
    await waitOptionsLoaded()

    await selectOption('Offering', 'CS 101 – FALL2025 A')
    await user.type(screen.getByLabelText('Title'), 'Final Project')
    await user.type(screen.getByLabelText('Slug'), 'final-project')
    await user.type(screen.getByLabelText('Git URL'), 'https://github.com/example/final-project.git')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    // Empty optional fields are sent as null
    expect(createProject).toHaveBeenCalledWith({
      offeringId: 1,
      title: 'Final Project',
      slug: 'final-project',
      subversionUrl: null,
      gitUrl: 'https://github.com/example/final-project.git',
      description: null
    })
    // Success notifies the page and closes the dialog
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('prefills the fields when editing an existing project', async () => {
    renderForm({ open: true, project: PROJECT_1 })

    expect(await screen.findByText('Edit Project')).toBeInTheDocument()
    // Text fields are available immediately
    expect(screen.getByLabelText('Title')).toHaveValue('Final Project')
    expect(screen.getByLabelText('Slug')).toHaveValue('final-project')
    expect(screen.getByLabelText('Git URL')).toHaveValue('https://github.com/example/final-project.git')
    expect(screen.getByLabelText('Description')).toHaveValue('Complete final assignment for the course')
    // The select shows its chosen value once the options have loaded
    expect(await screen.findByText('CS 101 – FALL2025 A')).toBeInTheDocument()
  })

  it('updates an existing project when saved', async () => {
    const { onClose, onSubmit } = renderForm({ open: true, project: PROJECT_1 })
    await waitOptionsLoaded()

    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Renamed Project')

    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(updateProject).toHaveBeenCalledWith(1, {
      offeringId: 1,
      title: 'Renamed Project',
      slug: 'final-project',
      subversionUrl: null,
      gitUrl: 'https://github.com/example/final-project.git',
      description: 'Complete final assignment for the course'
    })
    // Success notifies the page and closes the dialog
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sends null when an optional URL field is cleared while editing', async () => {
    const { onSubmit } = renderForm({ open: true, project: PROJECT_1 })
    await waitOptionsLoaded()

    await user.clear(screen.getByLabelText('Git URL'))

    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(updateProject).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ gitUrl: null })
    )
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('shows the server error when creation fails', async () => {
    createProject.mockRejectedValue(new Error('Failed to create project'))

    renderForm({ open: true })
    await waitOptionsLoaded()

    await selectOption('Offering', 'CS 101 – FALL2025 A')
    await user.type(screen.getByLabelText('Title'), 'Final Project')
    await user.type(screen.getByLabelText('Slug'), 'final-project')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Failed to create project')).toBeInTheDocument()
    // Dialog stays open on failure
    expect(screen.getByText('Create Project')).toBeInTheDocument()
  })

  it('shows the server error when an update fails', async () => {
    updateProject.mockRejectedValue(new Error('Teachers can only update projects in classes they teach'))

    renderForm({ open: true, project: PROJECT_1 })
    await waitOptionsLoaded()

    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByText(/only update projects in classes they teach/i)).toBeInTheDocument()
    expect(screen.getByText('Edit Project')).toBeInTheDocument()
  })

  it('shows an error when the option lists fail to load', async () => {
    fetchOfferings.mockRejectedValue(new Error('Failed to list offerings'))

    renderForm({ open: true })

    expect(await screen.findByText('Failed to list offerings')).toBeInTheDocument()
  })
})
