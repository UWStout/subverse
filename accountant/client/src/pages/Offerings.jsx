import { useState, useEffect, useCallback } from 'react'
import {
  Alert,
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
import SchoolIcon from '@mui/icons-material/School'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import Layout from '../components/Layout'
import PageHeader from '../components/PageHeader'
import FilterChips from '../components/FilterChips'
import ConfirmDialog from '../components/ConfirmDialog'
import RequireRole from '../components/RequireRole'
import { LoadingRow, EmptyRow } from '../components/TableRowStates'
import OfferingForm from '../components/OfferingForm'
import { fetchOfferings, fetchOfferingTerms, deleteOffering } from '../services/api'

/** Roles allowed to view / manage class offerings. */
const ALLOWED_ROLES = ['TEACHER']

/**
 * Class offering management page – lists offerings with server-side
 * pagination, filters by term, and provides create / edit / delete
 * actions via modals. Accessible to TEACHER accounts only.
 */
export default function Offerings () {
  // Gate the page: teachers only
  return (
    <RequireRole roles={ALLOWED_ROLES}>
      <OfferingsContent />
    </RequireRole>
  )
}

function OfferingsContent () {
  // Data state
  const [offerings, setOfferings] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Term filter chips (distinct terms from the API + 'All')
  const [terms, setTerms] = useState([])
  const [filterTerm, setFilterTerm] = useState('*')

  // Pagination (server-side)
  const [page, setPage] = useState(1)          // 1-based for API
  const [rowsPerPage, setRowsPerPage] = useState(10)

  // Modal state
  const [formOpen, setFormOpen] = useState(false)
  const [editingOffering, setEditingOffering] = useState(null)

  // Delete confirmation
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingOffering, setDeletingOffering] = useState(null)

  /* ---- Load offerings ---- */

  async function loadOfferings () {
    setLoading(true)
    setError('')
    try {
      const resp = await fetchOfferings(filterTerm, '', page, rowsPerPage)
      setOfferings(resp.data || [])
      setTotal(resp.total || 0)
    } catch (err) {
      setError(err.message)
      setOfferings([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOfferings()
  }, [filterTerm, page, rowsPerPage])

  /* ---- Load distinct terms for the filter chips (non-fatal on error) ---- */

  const loadTerms = useCallback(async () => {
    try {
      setTerms(await fetchOfferingTerms())
    } catch (err) {
      // A failed term lookup only means fewer filter chips; not fatal.
      setTerms([])
    }
  }, [])

  useEffect(() => {
    loadTerms()
  }, [loadTerms])

  /* ---- Handlers ---- */

  function handleFormSubmit () {
    // Reload the current page and refresh the term chips after a change
    loadOfferings()
    loadTerms()
  }

  function openCreate () {
    setEditingOffering(null)
    setFormOpen(true)
  }

  function openEdit (offering) {
    setEditingOffering(offering)
    setFormOpen(true)
  }

  function confirmDelete (offering) {
    setDeletingOffering(offering)
    setDeleteConfirmOpen(true)
  }

  async function handleDelete () {
    if (!deletingOffering) return
    try {
      await deleteOffering(deletingOffering.id)
      // If current page is now empty, go back one page
      if (offerings.length === 1 && page > 1) {
        setPage(p => p - 1)
      } else {
        loadOfferings()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleteConfirmOpen(false)
      setDeletingOffering(null)
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

  /* ---- Render helpers ---- */

  function classLabel (o) {
    if (!o || !o.class) return ''
    return `${o.class.subject} ${o.class.number}`.trim()
  }

  const termOptions = [
    { value: '*', label: 'All' },
    ...terms.map(t => ({ value: t, label: t }))
  ]

  /* ---- Render ---- */

  return (
    <Layout>
      {/* Page header with title and add button */}
      <PageHeader
        title='Class Offerings'
        actionLabel='Add Offering'
        onAction={openCreate}
        actionIcon={<SchoolIcon />}
      />

      {/* Error banner */}
      {error && (
        <Alert severity='error' sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>
      )}

      {/* Term filter chips */}
      <FilterChips
        label='Term:'
        options={termOptions}
        value={filterTerm}
        onChange={t => { setFilterTerm(t); setPage(1) }}
      />

      {/* Offering table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Class</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Term</TableCell>
              <TableCell>Section</TableCell>
              <TableCell>Teacher</TableCell>
              <TableCell align='right'>Actions</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {loading && <LoadingRow colSpan={7} />}

            {!loading && offerings.length === 0 && (
              <EmptyRow colSpan={7} text='No offerings found' />
            )}

            {!loading && offerings.map(o => (
              <TableRow key={o.id} hover>
                <TableCell>{o.id}</TableCell>
                <TableCell>{classLabel(o)}</TableCell>
                <TableCell>{o.class?.title || ''}</TableCell>
                <TableCell>{o.term}</TableCell>
                <TableCell>{o.section}</TableCell>
                <TableCell>{o.teacher?.username || ''}</TableCell>
                <TableCell align='right'>
                  <Tooltip title='Edit'>
                    <IconButton size='small' onClick={() => openEdit(o)}>
                      <EditIcon fontSize='small' />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title='Delete'>
                    <IconButton size='small' color='error' onClick={() => confirmDelete(o)}>
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
      <OfferingForm
        open={formOpen}
        offering={editingOffering}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
      />

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        title='Delete Offering'
        message={(
          <>
            Are you sure you want to delete{' '}
            <strong>{classLabel(deletingOffering)}</strong>{' '}
            ({deletingOffering?.term}, section {deletingOffering?.section})?
            This action cannot be undone.
          </>
        )}
        onConfirm={handleDelete}
        onClose={() => setDeleteConfirmOpen(false)}
      />
    </Layout>
  )
}
