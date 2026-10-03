import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThemeProvider } from '../src/context/ThemeContext'
import OfferingForm from '../src/components/OfferingForm'
import {
  createOffering,
  updateOffering,
  fetchClasses,
  fetchTeachers
} from '../src/services/api'

// Mock the API layer so tests never touch the network.
vi.mock('../src/services/api', () => ({
  createOffering: vi.fn(),
  updateOffering: vi.fn(),
  fetchClasses: vi.fn(),
  fetchTeachers: vi.fn()
}))

const CLASSES = [
  { id: 1, subject: 'CS', number: '101', title: 'Intro CS' },
  { id: 2, subject: 'MATH', number: '201', title: 'Calculus I' }
]
const TEACHERS = [
  { id: 1, username: 'prof', first_name: 'Pat', last_name: 'Fox' },
  { id: 5, username: 'taylor', first_name: 'Tay', last_name: 'Lor' }
]

const OFFERING_1 = {
  id: 1,
  class_id: 1,
  teacher_id: 1,
  term: 'FALL2025',
  section: 'A',
  class: CLASSES[0],
  teacher: TEACHERS[0]
}

function renderForm ({ open = true, offering = null } = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn()
  render(
    <ThemeProvider>
      <OfferingForm open={open} offering={offering} onClose={onClose} onSubmit={onSubmit} />
    </ThemeProvider>
  )
  return { onClose, onSubmit }
}

let user

/** Wait until the class / teacher option lists have finished loading. */
async function waitOptionsLoaded () {
  await waitFor(() => {
    expect(screen.queryByText(/Loading classes and teachers/)).not.toBeInTheDocument()
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

describe('OfferingForm', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    fetchClasses.mockResolvedValue({ data: CLASSES, total: 2, page: 1, limit: 100, totalPages: 1 })
    fetchTeachers.mockResolvedValue({ data: TEACHERS, total: 2, page: 1, limit: 100, totalPages: 1 })
    createOffering.mockResolvedValue(OFFERING_1)
    updateOffering.mockResolvedValue(OFFERING_1)
    user = await userEvent.setup()
  })

  it('renders nothing and loads no options when closed', () => {
    renderForm({ open: false })

    expect(screen.queryByText('Create Offering')).not.toBeInTheDocument()
    expect(fetchClasses).not.toHaveBeenCalled()
    expect(fetchTeachers).not.toHaveBeenCalled()
  })

  it('loads class and teacher options when opened in create mode', async () => {
    renderForm({ open: true })

    expect(await screen.findByText('Create Offering')).toBeInTheDocument()
    await waitOptionsLoaded()

    // Open the class listbox and check its options
    await user.click(screen.getByLabelText('Class'))
    expect(await screen.findByRole('option', { name: 'CS 101 – Intro CS' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'MATH 201 – Calculus I' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    // Open the teacher listbox and check its options
    await user.click(screen.getByLabelText('Teacher'))
    expect(await screen.findByRole('option', { name: 'prof' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'taylor' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    expect(fetchClasses).toHaveBeenCalled()
    expect(fetchTeachers).toHaveBeenCalled()
  })

  it('shows validation errors when submitting an empty form', async () => {
    renderForm({ open: true })
    // Wait for the option lists so the Create button is enabled
    await waitOptionsLoaded()

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Class is required')).toBeInTheDocument()
    expect(screen.getByText('Teacher is required')).toBeInTheDocument()
    expect(screen.getByText('Term is required')).toBeInTheDocument()
    expect(screen.getByText('Section is required')).toBeInTheDocument()
    expect(createOffering).not.toHaveBeenCalled()
  })

  it('creates an offering with the selected values', async () => {
    const { onClose, onSubmit } = renderForm({ open: true })
    await waitOptionsLoaded()

    await selectOption('Class', 'CS 101 – Intro CS')
    await selectOption('Teacher', 'prof')
    await user.type(screen.getByLabelText('Term'), 'FALL2025')
    await user.type(screen.getByLabelText('Section'), 'A')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(createOffering).toHaveBeenCalledWith({
      classId: 1,
      teacherId: 1,
      term: 'FALL2025',
      section: 'A'
    })
    // Success notifies the page and closes the dialog
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the server error when creation fails', async () => {
    createOffering.mockRejectedValue(new Error('An offering for this class already exists in this term and section'))

    renderForm({ open: true })
    await waitOptionsLoaded()

    await selectOption('Class', 'CS 101 – Intro CS')
    await selectOption('Teacher', 'prof')
    await user.type(screen.getByLabelText('Term'), 'FALL2025')
    await user.type(screen.getByLabelText('Section'), 'A')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText(/already exists in this term and section/)).toBeInTheDocument()
    // Dialog stays open on failure
    expect(screen.getByText('Create Offering')).toBeInTheDocument()
  })

  it('prefills the fields when editing an existing offering', async () => {
    renderForm({ open: true, offering: OFFERING_1 })

    expect(await screen.findByText('Edit Offering')).toBeInTheDocument()
    // Term / section are available immediately
    expect(screen.getByLabelText('Term')).toHaveValue('FALL2025')
    expect(screen.getByLabelText('Section')).toHaveValue('A')
    // The selects show their chosen values once the options have loaded
    expect(await screen.findByText('CS 101 – Intro CS')).toBeInTheDocument()
    expect(screen.getByText('prof')).toBeInTheDocument()
  })

  it('updates an existing offering when saved', async () => {
    const { onClose, onSubmit } = renderForm({ open: true, offering: OFFERING_1 })
    await waitOptionsLoaded()

    await user.clear(screen.getByLabelText('Section'))
    await user.type(screen.getByLabelText('Section'), 'B')

    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(updateOffering).toHaveBeenCalledWith(1, {
      classId: 1,
      teacherId: 1,
      term: 'FALL2025',
      section: 'B'
    })
    // Success notifies the page and closes the dialog
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the server error when an update fails', async () => {
    updateOffering.mockRejectedValue(new Error('Another offering already exists for this class, term and section'))

    renderForm({ open: true, offering: OFFERING_1 })
    await waitOptionsLoaded()

    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByText(/already exists for this class, term and section/)).toBeInTheDocument()
    expect(screen.getByText('Edit Offering')).toBeInTheDocument()
  })

  it('shows an error when the option lists fail to load', async () => {
    fetchClasses.mockRejectedValue(new Error('Failed to list classes'))

    renderForm({ open: true })

    expect(await screen.findByText('Failed to list classes')).toBeInTheDocument()
  })
})
