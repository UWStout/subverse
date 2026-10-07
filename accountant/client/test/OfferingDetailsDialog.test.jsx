import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThemeProvider } from '../src/context/ThemeContext'
import OfferingDetailsDialog from '../src/components/OfferingDetailsDialog'
import { fetchOffering } from '../src/services/api'

// Mock the API layer so tests never touch the network.
vi.mock('../src/services/api', () => ({
  fetchOffering: vi.fn()
}))

const OFFERING = { id: 1 }

const FULL_OFFERING = {
  id: 1,
  class_id: 1,
  teacher_id: 2,
  term: 'FALL25',
  section: '101',
  class: { id: 1, subject: 'CS', number: '458', title: 'Software Engineering Practicum' },
  teacher: { id: 2, username: 'lito', email: 'lito@uni.edu' },
  projects: [
    {
      id: 10,
      title: 'DevOps Dashboard',
      slug: 'devops-dashboard-fall25-101',
      subversion_url: 'https://svn.university.edu/courses/CS458/fall25/101/devops-dashboard-fall25-101',
      git_url: null
    },
    {
      id: 11,
      title: 'CI Sandbox',
      slug: 'ci-sandbox-fall25-101',
      subversion_url: null,
      git_url: 'https://git.university.edu/courses/CS458/ci-sandbox-fall25-101.git'
    }
  ]
}

const EMPTY_OFFERING = { ...FULL_OFFERING, projects: [] }

function renderDialog ({ open = true, offering = OFFERING } = {}) {
  const onClose = vi.fn()
  render(
    <ThemeProvider>
      <OfferingDetailsDialog open={open} offering={offering} onClose={onClose} />
    </ThemeProvider>
  )
  return { onClose }
}

describe('OfferingDetailsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchOffering.mockResolvedValue(FULL_OFFERING)
  })

  it('renders nothing and does not fetch when closed', () => {
    renderDialog({ open: false })

    expect(screen.queryByText('Offering Details')).not.toBeInTheDocument()
    expect(fetchOffering).not.toHaveBeenCalled()
  })

  it('fetches by id and shows the class, term, section and teacher', async () => {
    renderDialog()

    expect(await screen.findByText('Offering Details')).toBeInTheDocument()
    expect(fetchOffering).toHaveBeenCalledWith(1)
    expect(screen.getByText('CS 458 – Software Engineering Practicum')).toBeInTheDocument()
    expect(screen.getByText('FALL25')).toBeInTheDocument()
    expect(screen.getByText('101')).toBeInTheDocument()
    expect(screen.getByText('lito (lito@uni.edu)')).toBeInTheDocument()
  })

  it('lists all projects in the offering with their repo URLs', async () => {
    renderDialog()

    expect(await screen.findByText('Projects (2)')).toBeInTheDocument()
    expect(screen.getByText('DevOps Dashboard')).toBeInTheDocument()
    expect(screen.getByText('CI Sandbox')).toBeInTheDocument()
    expect(screen.getByText('https://svn.university.edu/courses/CS458/fall25/101/devops-dashboard-fall25-101')).toBeInTheDocument()
    expect(screen.getByText('https://git.university.edu/courses/CS458/ci-sandbox-fall25-101.git')).toBeInTheDocument()
  })

  it('shows a note when the offering has no projects', async () => {
    fetchOffering.mockResolvedValue(EMPTY_OFFERING)

    renderDialog()

    expect(await screen.findByText('Projects (0)')).toBeInTheDocument()
    expect(screen.getByText('No projects in this offering.')).toBeInTheDocument()
  })

  it('shows the server error when the fetch fails', async () => {
    fetchOffering.mockRejectedValue(new Error('Failed to fetch offering'))

    renderDialog()

    expect(await screen.findByText('Failed to fetch offering')).toBeInTheDocument()
  })

  it('calls onClose when Close is clicked', async () => {
    const { onClose } = renderDialog()

    await screen.findByText('Offering Details')
    await screen.getByRole('button', { name: 'Close' }).click()

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
