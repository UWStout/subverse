import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThemeProvider } from '../src/context/ThemeContext'
import UserDetailsDialog from '../src/components/UserDetailsDialog'
import { fetchUser } from '../src/services/api'

// Mock the API layer so tests never touch the network.
vi.mock('../src/services/api', () => ({
  fetchUser: vi.fn()
}))

const USER = { id: 1, username: 'alice' }

const TEACHER_USER = {
  id: 1,
  username: 'alice',
  first_name: 'Alice',
  last_name: 'Liddell',
  email: 'alice@uni.edu',
  type: 'TEACHER',
  taught_offerings: [
    {
      id: 5,
      term: 'FALL25',
      section: '101',
      class: { id: 1, subject: 'GDD', number: '200', title: 'Intro to Game Development' }
    }
  ],
  assignments: []
}

const STUDENT_USER = {
  id: 2,
  username: 'bob',
  first_name: 'Bob',
  last_name: 'Builder',
  email: 'bob@uni.edu',
  type: 'STUDENT',
  taught_offerings: [],
  assignments: [
    {
      student_id: 2,
      project_id: 9,
      project: {
        id: 9,
        title: 'Release Manager Sim',
        slug: 'release-manager-sim-spring26-102',
        offering: {
          term: 'SPRING26',
          section: '102',
          class: { subject: 'CS', number: '458', title: 'Software Engineering Practicum' }
        }
      }
    }
  ]
}

const EMPTY_USER = { ...STUDENT_USER, taught_offerings: [], assignments: [] }

function renderDialog ({ open = true, user = USER } = {}) {
  const onClose = vi.fn()
  render(
    <ThemeProvider>
      <UserDetailsDialog open={open} user={user} onClose={onClose} />
    </ThemeProvider>
  )
  return { onClose }
}

describe('UserDetailsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchUser.mockResolvedValue(TEACHER_USER)
  })

  it('renders nothing and does not fetch when closed', () => {
    renderDialog({ open: false })

    expect(screen.queryByText('User Details')).not.toBeInTheDocument()
    expect(fetchUser).not.toHaveBeenCalled()
  })

  it('fetches by id and shows the basic fields', async () => {
    renderDialog()

    expect(await screen.findByText('User Details')).toBeInTheDocument()
    expect(fetchUser).toHaveBeenCalledWith(1)
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('Alice Liddell')).toBeInTheDocument()
    expect(screen.getByText('alice@uni.edu')).toBeInTheDocument()
  })

  it('lists the classes this user teaches, with term and section', async () => {
    renderDialog()

    expect(await screen.findByText('Teaches (1)')).toBeInTheDocument()
    expect(screen.getByText('GDD 200 – Intro to Game Development')).toBeInTheDocument()
    expect(screen.getByText('(FALL25, section 101)')).toBeInTheDocument()
  })

  it('lists the projects this user is assigned to, with class context', async () => {
    fetchUser.mockResolvedValue(STUDENT_USER)

    renderDialog()

    expect(await screen.findByText('Assigned Projects (1)')).toBeInTheDocument()
    expect(screen.getByText('Release Manager Sim')).toBeInTheDocument()
    expect(screen.getByText('(CS 458, SPRING26, section 102)')).toBeInTheDocument()
  })

  it('shows a note when the user has neither offerings nor assignments', async () => {
    fetchUser.mockResolvedValue(EMPTY_USER)

    renderDialog()

    expect(await screen.findByText('No offerings taught and no project assignments.')).toBeInTheDocument()
  })

  it('shows the server error when the fetch fails', async () => {
    fetchUser.mockRejectedValue(new Error('Failed to fetch user'))

    renderDialog()

    expect(await screen.findByText('Failed to fetch user')).toBeInTheDocument()
  })

  it('calls onClose when Close is clicked', async () => {
    const { onClose } = renderDialog()

    await screen.findByText('User Details')
    await screen.getByRole('button', { name: 'Close' }).click()

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
