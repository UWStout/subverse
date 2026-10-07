import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThemeProvider } from '../src/context/ThemeContext'
import ProjectDetailsDialog from '../src/components/ProjectDetailsDialog'
import { fetchProject } from '../src/services/api'

// Mock the API layer so tests never touch the network.
vi.mock('../src/services/api', () => ({
  fetchProject: vi.fn()
}))

const PROJECT = { id: 10 }

const FULL_PROJECT = {
  id: 10,
  title: 'DevOps Dashboard',
  slug: 'devops-dashboard-fall25-101',
  description: 'A simulated release pipeline for the practicum.',
  subversion_url: 'https://svn.university.edu/courses/CS458/fall25/101/devops-dashboard-fall25-101',
  git_url: null,
  offering: {
    id: 1,
    term: 'FALL25',
    section: '101',
    class: { id: 1, subject: 'CS', number: '458', title: 'Software Engineering Practicum' },
    teacher: { id: 2, username: 'lito', email: 'lito@uni.edu' }
  },
  assignments: [
    { student_id: 3, project_id: 10, student: { id: 3, username: 'lellison', email: 'lellison@university.edu' } },
    { student_id: 4, project_id: 10, student: { id: 4, username: 'aosei', email: 'aosei@university.edu' } }
  ]
}

// What the server returns to a STUDENT viewer: no assignments key at all.
const STUDENT_VIEW_PROJECT = { ...FULL_PROJECT, assignments: undefined }

function renderDialog ({ open = true, project = PROJECT } = {}) {
  const onClose = vi.fn()
  render(
    <ThemeProvider>
      <ProjectDetailsDialog open={open} project={project} onClose={onClose} />
    </ThemeProvider>
  )
  return { onClose }
}

describe('ProjectDetailsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchProject.mockResolvedValue(FULL_PROJECT)
  })

  it('renders nothing and does not fetch when closed', () => {
    renderDialog({ open: false })

    expect(screen.queryByText('Project Details')).not.toBeInTheDocument()
    expect(fetchProject).not.toHaveBeenCalled()
  })

  it('fetches by id and shows the project fields', async () => {
    renderDialog()

    expect(await screen.findByText('Project Details')).toBeInTheDocument()
    expect(fetchProject).toHaveBeenCalledWith(10)
    expect(screen.getByText('DevOps Dashboard')).toBeInTheDocument()
    expect(screen.getByText('devops-dashboard-fall25-101')).toBeInTheDocument()
    expect(screen.getByText('A simulated release pipeline for the practicum.')).toBeInTheDocument()
    expect(screen.getByText('https://svn.university.edu/courses/CS458/fall25/101/devops-dashboard-fall25-101')).toBeInTheDocument()
  })

  it('shows the offering with class, term, section and teacher', async () => {
    renderDialog()

    expect(await screen.findByText('Offering')).toBeInTheDocument()
    expect(screen.getByText('CS 458 – Software Engineering Practicum')).toBeInTheDocument()
    expect(screen.getByText('FALL25, section 101')).toBeInTheDocument()
    expect(screen.getByText('Teacher: lito (lito@uni.edu)')).toBeInTheDocument()
  })

  it('lists the assigned students for teachers and admins', async () => {
    renderDialog()

    expect(await screen.findByText('Assigned Students (2)')).toBeInTheDocument()
    expect(screen.getByText('lellison')).toBeInTheDocument()
    expect(screen.getByText('(lellison@university.edu)')).toBeInTheDocument()
    expect(screen.getByText('aosei')).toBeInTheDocument()
  })

  it('shows a note instead of the student list when assignments are omitted (student view)', async () => {
    fetchProject.mockResolvedValue(STUDENT_VIEW_PROJECT)

    renderDialog()

    expect(await screen.findByText('The assigned student list is not visible to student accounts.')).toBeInTheDocument()
    expect(screen.queryByText(/Assigned Students/)).not.toBeInTheDocument()
  })

  it('shows the server error when the fetch fails', async () => {
    fetchProject.mockRejectedValue(new Error('Failed to fetch project'))

    renderDialog()

    expect(await screen.findByText('Failed to fetch project')).toBeInTheDocument()
  })

  it('calls onClose when Close is clicked', async () => {
    const { onClose } = renderDialog()

    await screen.findByText('Project Details')
    await screen.getByRole('button', { name: 'Close' }).click()

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
