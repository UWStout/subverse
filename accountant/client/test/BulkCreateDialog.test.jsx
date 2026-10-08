import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThemeProvider } from '../src/context/ThemeContext'
import BulkCreateDialog from '../src/components/BulkCreateDialog'
import { bulkCreateUsers } from '../src/services/api'

// Mock the API layer so tests never touch the network.
vi.mock('../src/services/api', () => ({
  bulkCreateUsers: vi.fn()
}))

const PROJECT = {
  id: 4,
  offering_id: 1,
  title: 'Release Manager Sim',
  slug: 'release-manager-sim'
}

function renderDialog ({ open = true, project = PROJECT } = {}) {
  const onClose = vi.fn()
  const onDone = vi.fn()
  render(
    <ThemeProvider>
      <BulkCreateDialog open={open} project={project} onClose={onClose} onDone={onDone} />
    </ThemeProvider>
  )
  return { onClose, onDone }
}

let user

describe('BulkCreateDialog', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    bulkCreateUsers.mockResolvedValue({
      project_id: PROJECT.id,
      total: 2,
      created: 1,
      assigned: 1,
      already_assigned: 0,
      results: [],
      errors: [],
      email_failures: []
    })
    user = await userEvent.setup()
  })

  it('renders nothing when closed', () => {
    renderDialog({ open: false })
    expect(screen.queryByLabelText('Roster')).not.toBeInTheDocument()
  })

  it('shows the project title and format examples when open', () => {
    renderDialog()
    expect(screen.getByText(/Bulk Add Students/)).toBeInTheDocument()
    expect(screen.getByText(/Release Manager Sim/)).toBeInTheDocument()
    expect(screen.getByLabelText('Roster')).toBeInTheDocument()
  })

  it('disables the submit button while the roster is empty', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: 'Add Students' })).toBeDisabled()
  })

  it('posts the roster to the API and shows the summary on success', async () => {
    const { onDone } = renderDialog()
    const roster = 'Doe, John <jdoe@x.edu>\nSmith, Jane <jsmith@x.edu>'

    await user.type(screen.getByLabelText('Roster'), roster)
    await user.click(screen.getByRole('button', { name: 'Add Students' }))

    expect(bulkCreateUsers).toHaveBeenCalledWith(PROJECT.id, roster)
    await waitFor(() => {
      expect(screen.getByText(/Processed 2 entries: created 1, assigned to the project 1\./)).toBeInTheDocument()
    })
    // The roster form is replaced by the summary; onDone fired with it
    expect(screen.queryByLabelText('Roster')).not.toBeInTheDocument()
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone.mock.calls[0][0].created).toBe(1)
  })

  it('mentions the set-password email when accounts were created', async () => {
    renderDialog()
    await user.type(screen.getByLabelText('Roster'), 'Doe, John <jdoe@x.edu>')
    await user.click(screen.getByRole('button', { name: 'Add Students' }))

    await waitFor(() => {
      expect(screen.getByText(/set your password/)).toBeInTheDocument()
    })
  })

  it('lists per-entry errors from the summary', async () => {
    bulkCreateUsers.mockResolvedValue({
      project_id: PROJECT.id,
      total: 3,
      created: 1,
      assigned: 0,
      already_assigned: 0,
      results: [],
      errors: [
        { index: 2, raw: 'garbage line', reason: 'Missing <email> address' },
        { index: 3, raw: 'Doe, John <jdoe@x.edu>', reason: "Username 'jdoe' already belongs to jdoe (other@x.edu)" }
      ],
      email_failures: []
    })

    renderDialog()
    await user.type(screen.getByLabelText('Roster'), 'Doe, John <jdoe@x.edu>\ngarbage line\nSmith, Jane <jsmith@x.edu>')
    await user.click(screen.getByRole('button', { name: 'Add Students' }))

    await waitFor(() => {
      expect(screen.getByText(/2 entries were not processed/)).toBeInTheDocument()
    })
    expect(screen.getByText('Entry 2: Missing <email> address')).toBeInTheDocument()
    expect(screen.getByText("Entry 3: Username 'jdoe' already belongs to jdoe (other@x.edu)")).toBeInTheDocument()
  })

  it('reports email delivery failures', async () => {
    bulkCreateUsers.mockResolvedValue({
      project_id: PROJECT.id,
      total: 1,
      created: 1,
      assigned: 0,
      already_assigned: 0,
      results: [],
      errors: [],
      email_failures: ['jdoe@x.edu']
    })

    renderDialog()
    await user.type(screen.getByLabelText('Roster'), 'Doe, John <jdoe@x.edu>')
    await user.click(screen.getByRole('button', { name: 'Add Students' }))

    await waitFor(() => {
      expect(screen.getByText(/could not be delivered to: jdoe@x\.edu/)).toBeInTheDocument()
    })
  })

  it('shows the server error message when the request fails', async () => {
    bulkCreateUsers.mockRejectedValue(new Error('Teachers can only add users to projects in classes they teach'))

    renderDialog()
    await user.type(screen.getByLabelText('Roster'), 'Doe, John <jdoe@x.edu>')
    await user.click(screen.getByRole('button', { name: 'Add Students' }))

    await waitFor(() => {
      expect(screen.getByText(/Teachers can only add users/)).toBeInTheDocument()
    })
    // The form stays visible so the operator can retry or cancel
    expect(screen.getByLabelText('Roster')).toBeInTheDocument()
  })

  it('starts with a fresh form when reopened', async () => {
    const element = (open) => (
      <ThemeProvider>
        <BulkCreateDialog open={open} project={PROJECT} onClose={vi.fn()} />
      </ThemeProvider>
    )
    const { rerender } = render(element(true))

    await user.type(screen.getByLabelText('Roster'), 'Doe, John <jdoe@x.edu>')
    await user.click(screen.getByRole('button', { name: 'Add Students' }))
    await waitFor(() => {
      expect(screen.queryByLabelText('Roster')).not.toBeInTheDocument()
    })

    // Close and reopen - the previous roster and summary are gone
    rerender(element(false))
    rerender(element(true))
    expect(screen.getByLabelText('Roster')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Add Students' })).toBeDisabled()
  })

  it('closes via the cancel button', async () => {
    const { onClose } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
