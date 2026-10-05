import { useState, useEffect, useCallback, useMemo } from 'react'
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
import AssignmentIcon from '@mui/icons-material/Assignment'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import Layout from '../components/Layout'
import PageHeader from '../components/PageHeader'
import FilterChips from '../components/FilterChips'
import ConfirmDialog from '../components/ConfirmDialog'
import { LoadingRow, EmptyRow } from '../components/TableRowStates'
import ProjectForm from '../components/ProjectForm'
import { useAuth } from '../context/AuthContext'
import { fetchProjects, deleteProject, fetchOfferingTerms, fetchClasses, fetchOfferings } from '../services/api'

/** Roles that may create / edit / delete projects; students are read-only. */
const MANAGE_ROLES = ['TEACHER', 'ADMIN']

/**
 * Project management page - lists projects with server-side pagination,
 * filters by class and/or term (the list API requires at least one), and
 * provides create / edit / delete actions via modals for TEACHER and ADMIN
 * accounts. STUDENT accounts see a read-only view of their assigned
 * projects (the server restricts the rows they can receive).
 */
export default function Projects () {
  const { user } = useAuth()
  // Students get no create / edit / delete controls at all
  const canManage = !!user && MANAGE_ROLES.includes(user.type)

  // Data state
  const [projects, setProjects] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Filters - the list API requires at least one concrete value ('*' = any).
  // filterClass is a subject-number code (e.g. 'CS-101'), filterTerm a term.
  const [filterClass, setFilterClass] = useState('*')
  const [filterTerm, setFilterTerm] = useState('*')

  // Reference lists for mapping offering_id / class_id to display labels.
  // The list API returns plain rows (no joins); these lists are small and
  // are loaded once on mount.
  const [classOptions, setClassOptions] = useState([])
  const [offeringOptions, setOfferingOptions] = useState([])

  // Term filter chips (distinct terms from the API + 'All')
  const [terms, setTerms] = useState([])

  // Pagination (server-side)
  const [page, setPage] = useState(1)          // 1-based for API
  const [rowsPerPage, setRowsPerPage] = useState(10)

  // Modal state
  const [formOpen, setFormOpen] = useState(false)
  const [editingProject, setEditingProject] = useState(null)

  // Delete confirmation
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingProject, setDeletingProject] = useState(null)

  const hasFilter = filterClass !== '*' || filterTerm !== '*'

  /* ---- Load projects ---- */

  async function loadProjects () {
    if (!hasFilter) return // the API rejects an all-wildcard request
    setLoading(true)
    setError('')
    try {
      const resp = await fetchProjects(filterClass, filterTerm, page, rowsPerPage)
      setProjects(resp.data || [])
      setTotal(resp.total || 0)
    } catch (err) {
      setError(err.message)
      setProjects([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
  }, [filterClass, filterTerm, page, rowsPerPage])

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

  /* ---- Load reference lists for ID -> label mapping (non-fatal on error) ---- */

  const loadReferenceLists = useCallback(async () => {
    try {
      const [classesResp, offeringsResp] = await Promise.all([
        fetchClasses(1, 100),
        fetchOfferings('*', '*', '*', 1, 100)
      ])
      setClassOptions(classesResp.data || [])
      setOfferingOptions(offeringsResp.data || [])
    } catch (err) {
      // Missing reference lists only blank out the labels; not fatal.
      setClassOptions([])
      setOfferingOptions([])
    }
  }, [])

  useEffect(() => {
    loadReferenceLists()
  }, [loadReferenceLists])

  const classById = useMemo(() => new Map(classOptions.map(c => [c.id, c])), [classOptions])
  const offeringById = useMemo(() => new Map(offeringOptions.map(o => [o.id, o])), [offeringOptions])

  /* ---- Handlers ---- */

  function handleFormSubmit () {
    // Reload the current page and refresh the term chips after a change
    loadProjects()
    loadTerms()
  }

  function openCreate () {
    setEditingProject(null)
    setFormOpen(true)
  }

  function openEdit (project) {
    setEditingProject(project)
    setFormOpen(true)
  }

  function confirmDelete (project) {
    setDeletingProject(project)
    setDeleteConfirmOpen(true)
  }

  async function handleDelete () {
    if (!deletingProject) return
    try {
      await deleteProject(deletingProject.id)
      // If current page is now empty, go back one page
      if (projects.length === 1 && page > 1) {
        setPage(p => p - 1)
      } else {
        loadProjects()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleteConfirmOpen(false)
      setDeletingProject(null)
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

  function classLabel (p) {
    const offering = p && offeringById.get(p.offering_id)
    if (!offering) return ''
    const cls = classById.get(offering.class_id)
    return cls ? `${cls.subject} ${cls.number}` : ''
  }

  const classOptionsForChips = [
    { value: '*', label: 'All' },
    ...classOptions.map(c => ({ value: `${c.subject}-${c.number}`, label: `${c.subject} ${c.number}` }))
  ]

  const termOptions = [
    { value: '*', label: 'All' },
    ...terms.map(t => ({ value: t, label: t }))
  ]

  // Students get no actions column
  const colSpan = canManage ? 6 : 5

  /* ---- Render ---- */

  return (
    <Layout>
      {/* Page header with title and add button (managers only) */}
      <PageHeader
        title='Class Projects'
        actionLabel={canManage ? 'Add Project' : undefined}
        onAction={openCreate}
        actionIcon={<AssignmentIcon />}
      />

      {/* Error banner */}
      {error && (
        <Alert severity='error' sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>
      )}

      {/* Class / term filter chips - at least one must be concrete */}
      <FilterChips
        label='Class:'
        options={classOptionsForChips}
        value={filterClass}
        onChange={c => { setFilterClass(c); setPage(1) }}
      />
      <FilterChips
        label='Term:'
        options={termOptions}
        value={filterTerm}
        onChange={t => { setFilterTerm(t); setPage(1) }}
      />

      {hasFilter
        ? (
          /* Project table */
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Class</TableCell>
                  <TableCell>Term</TableCell>
                  <TableCell>Repo</TableCell>
                  {canManage && <TableCell align='right'>Actions</TableCell>}
                </TableRow>
              </TableHead>

              <TableBody>
                {loading && <LoadingRow colSpan={colSpan} />}

                {!loading && projects.length === 0 && (
                  <EmptyRow colSpan={colSpan} text='No projects found' />
                )}

                {!loading && projects.map(p => (
                  <TableRow key={p.id} hover>
                    <TableCell>{p.id}</TableCell>
                    <TableCell>{p.title}</TableCell>
                    <TableCell>{classLabel(p)}</TableCell>
                    <TableCell>{offeringById.get(p.offering_id)?.term || ''}</TableCell>
                    <TableCell>{p.git_url || p.subversion_url || ''}</TableCell>
                    {canManage && (
                      <TableCell align='right'>
                        <Tooltip title='Edit'>
                          <IconButton size='small' onClick={() => openEdit(p)}>
                            <EditIcon fontSize='small' />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title='Delete'>
                          <IconButton size='small' color='error' onClick={() => confirmDelete(p)}>
                            <DeleteIcon fontSize='small' />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
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
        )
        : (
          <Alert severity='info' sx={{ mb: 2 }}>
            Select a class or a term to view projects.
          </Alert>
        )}

      {/* Create / Edit modal (managers only) */}
      {canManage && (
        <ProjectForm
          open={formOpen}
          project={editingProject}
          onClose={() => setFormOpen(false)}
          onSubmit={handleFormSubmit}
        />
      )}

      {/* Delete confirmation dialog (managers only) */}
      {canManage && (
        <ConfirmDialog
          open={deleteConfirmOpen}
          title='Delete Project'
          message={(
            <>
              Are you sure you want to delete{' '}
              <strong>{deletingProject?.title}</strong>
              {classLabel(deletingProject) ? ` (${classLabel(deletingProject)})` : ''}?
              This action cannot be undone.
            </>
          )}
          onConfirm={handleDelete}
          onClose={() => setDeleteConfirmOpen(false)}
        />
      )}
    </Layout>
  )
}
