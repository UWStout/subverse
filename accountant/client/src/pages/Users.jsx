import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  Alert,
  Box,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TablePagination,
  Tooltip
} from '@mui/material'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import MailOutlinedIcon from '@mui/icons-material/MailOutlined'
import InfoIcon from '@mui/icons-material/Info'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import Layout from '../components/Layout'
import PageHeader from '../components/PageHeader'
import FilterChips from '../components/FilterChips'
import ConfirmDialog from '../components/ConfirmDialog'
import { LoadingRow, EmptyRow } from '../components/TableRowStates'
import UserForm from '../components/UserForm'
import UserDetailsDialog from '../components/UserDetailsDialog'
import { fetchUsers, deleteUser } from '../services/api'

const TYPE_OPTIONS = [
  { value: '*', label: 'All' },
  { value: 'STUDENT', label: 'STUDENT' },
  { value: 'TEACHER', label: 'TEACHER' },
  { value: 'ADMIN', label: 'ADMIN' }
]

const TYPE_COLORS = {
  STUDENT: 'default',
  TEACHER: 'primary',
  ADMIN: 'error'
}

/**
 * User management page – lists accounts with server-side pagination,
 * filters by type, and provides create / edit / delete actions via modals.
 */
export default function Users () {
  const { protect } = useAuth()

  // Protect the component
  const protectedContent = protect(
    <UsersContent />
  )

  if (!protectedContent) {
    return null
  }

  return protectedContent
}

function UsersContent () {
  // Data state
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Filter & pagination (server-side)
  const [filterType, setFilterType] = useState('*')
  const [page, setPage] = useState(1)          // 1-based for API
  const [rowsPerPage, setRowsPerPage] = useState(10)

  // Modal state
  const [formOpen, setFormOpen] = useState(false)
  const [editingUser, setEditingUser] = useState(null)

  // Details dialog
  const [detailsUser, setDetailsUser] = useState(null)

  // Delete confirmation
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingUser, setDeletingUser] = useState(null)

  /* ---- Load users ---- */

  async function loadUsers () {
    setLoading(true)
    setError('')
    try {
      const resp = await fetchUsers(filterType, page, rowsPerPage)
      setUsers(resp.data || [])
      setTotal(resp.total || 0)
    } catch (err) {
      setError(err.message)
      setUsers([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [filterType, page, rowsPerPage])

  /* ---- Handlers ---- */

  function handleFormSubmit (createdUser) {
    // Reload the current page after a successful create / update
    loadUsers()
    // New accounts are provisional until their email is verified; tell the
    // operator that the verification email is on its way to the new user.
    if (createdUser?.email) {
      setNotice(`A verification email has been sent to ${createdUser.email} - they must open it and click the link before they can sign in.`)
    }
  }

  function openCreate () {
    setEditingUser(null)
    setFormOpen(true)
  }

  function openEdit (user) {
    setEditingUser(user)
    setFormOpen(true)
  }

  function confirmDelete (user) {
    setDeletingUser(user)
    setDeleteConfirmOpen(true)
  }

  async function handleDelete () {
    if (!deletingUser) return
    try {
      await deleteUser(deletingUser.id)
      // If current page is now empty, go back one page
      if (users.length === 1 && page > 1) {
        setPage(p => p - 1)
      } else {
        loadUsers()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleteConfirmOpen(false)
      setDeletingUser(null)
    }
  }

  /* ---- Pagination helpers ---- */

  function handleChangePage (_, newPage) {
    setPage(newPage + 1) // MUI is 0-based, API is 1-based
  }

  function handleChangeRowsPerPage (e) {
    setRowsPerPage(parseInt(e.target.value, 10))
    setPage(1) // reset to first page when changing page size
  }

  /* ---- Render ---- */

  return (
    <Layout>
      {/* Page header with title and add button */}
      <PageHeader
        title='User Accounts'
        actionLabel='Add User'
        onAction={openCreate}
        actionIcon={<PersonAddIcon />}
      />

      {/* Error banner */}
      {error && (
        <Alert severity='error' sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>
      )}

      {/* Post-create notice about the verification email */}
      {notice && (
        <Alert severity='info' sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>
      )}

      {/* Type filter chips */}
      <FilterChips
        label='Filter:'
        options={TYPE_OPTIONS}
        value={filterType}
        onChange={t => { setFilterType(t); setPage(1) }}
      />

      {/* User table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Username</TableCell>
              <TableCell>First Name</TableCell>
              <TableCell>Last Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align='right'>Actions</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {loading && <LoadingRow colSpan={7} />}

            {!loading && users.length === 0 && (
              <EmptyRow colSpan={7} text='No users found' />
            )}

            {!loading && users.map(u => (
              <TableRow key={u.id} hover>
                <TableCell>{u.id}</TableCell>
                <TableCell>{u.username}</TableCell>
                <TableCell>{u.first_name || ''}</TableCell>
                <TableCell>{u.last_name || ''}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    <Chip label={u.type} color={TYPE_COLORS[u.type] || 'default'} size='small' />
                    {u.verification_sent_at != null && (
                      <Tooltip title='Email address not yet verified - the account is locked out until they click the emailed link'>
                        <Chip
                          icon={<MailOutlinedIcon />}
                          label='Unverified'
                          color='warning'
                          variant='outlined'
                          size='small'
                        />
                      </Tooltip>
                    )}
                  </Box>
                </TableCell>
                <TableCell align='right'>
                  <Tooltip title='Details'>
                    <IconButton size='small' onClick={() => setDetailsUser(u)}>
                      <InfoIcon fontSize='small' />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title='Edit'>
                    <IconButton size='small' onClick={() => openEdit(u)}>
                      <EditIcon fontSize='small' />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title='Delete'>
                    <IconButton size='small' color='error' onClick={() => confirmDelete(u)}>
                      <DeleteIcon fontSize='small' />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <TablePagination
          component='div'
          count={total}
          page={page - 1} // MUI is 0-based, our state is 1-based
          onPageChange={handleChangePage}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          rowsPerPageOptions={[5, 10, 25, 50]}
        />
      </TableContainer>

      {/* Create / Edit modal */}
      <UserForm
        open={formOpen}
        user={editingUser}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
      />

      {/* Details dialog */}
      <UserDetailsDialog
        open={!!detailsUser}
        user={detailsUser}
        onClose={() => setDetailsUser(null)}
      />

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        title='Delete User'
        message={(
          <>
            Are you sure you want to delete{' '}
            <strong>{deletingUser?.username}</strong>? This action cannot be undone.
          </>
        )}
        onConfirm={handleDelete}
        onClose={() => setDeleteConfirmOpen(false)}
      />
    </Layout>
  )
}
