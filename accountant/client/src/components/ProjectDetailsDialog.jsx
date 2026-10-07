import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography
} from '@mui/material'
import { fetchProject } from '../services/api'

/** One label / value row in the details body. */
function Field ({ label, children }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, py: 0.5 }}>
      <Typography component='div' variant='body2' color='text.secondary' sx={{ minWidth: 110, flexShrink: 0 }}>{label}</Typography>
      <Typography component='div' variant='body2'>{children}</Typography>
    </Box>
  )
}

/** Titled sub-section inside the details body. */
function Section ({ title, children }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant='subtitle2' color='text.secondary'>{title}</Typography>
      <Divider sx={{ my: 1 }} />
      {children}
    </Box>
  )
}

/**
 * Read-only dialog showing the full details of one project, joined one level
 * deep: its offering (class, term, section, teacher) and the students
 * assigned to it. The server omits the assignment list for student accounts,
 * in which case a note is shown instead.
 *
 * Props
 * -----
 * open     – boolean controlling visibility
 * project  – project object from the list (must have an id) or null
 * onClose  – () => void  called when the dialog closes
 */
export default function ProjectDetailsDialog ({ open, project, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Fetch fresh details whenever the dialog opens for a (new) project.
  useEffect(() => {
    if (!open || !project) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    setData(null)
    fetchProject(project.id)
      .then(result => { if (!cancelled) setData(result) })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, project])

  const offering = data?.offering
  const cls = offering?.class
  const students = Array.isArray(data?.assignments) ? data.assignments : null

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>Project Details</DialogTitle>

      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {!loading && error && <Alert severity='error'>{error}</Alert>}

        {!loading && !error && data && (
          <Box>
            <Field label='Title'>{data.title}</Field>
            <Field label='Slug'>
              <Typography component='span' variant='body2' sx={{ wordBreak: 'break-all' }}>{data.slug}</Typography>
            </Field>
            {data.description && (
              <Field label='Description'>{data.description}</Field>
            )}
            {data.subversion_url && (
              <Field label='SVN URL'>
                <Typography component='span' variant='body2' sx={{ wordBreak: 'break-all' }}>{data.subversion_url}</Typography>
              </Field>
            )}
            {data.git_url && (
              <Field label='Git URL'>
                <Typography component='span' variant='body2' sx={{ wordBreak: 'break-all' }}>{data.git_url}</Typography>
              </Field>
            )}

            {offering && (
              <Section title='Offering'>
                <Typography variant='body2'>
                  {cls ? `${cls.subject} ${cls.number} – ${cls.title}` : 'Unknown class'}
                </Typography>
                <Typography variant='body2' color='text.secondary'>
                  {offering.term}, section {offering.section}
                </Typography>
                {offering.teacher && (
                  <Typography variant='body2' sx={{ mt: 0.5 }}>
                    Teacher: {offering.teacher.username} ({offering.teacher.email})
                  </Typography>
                )}
              </Section>
            )}

            {students !== null && (
              <Section title={`Assigned Students (${students.length})`}>
                {students.length === 0 && (
                  <Typography variant='body2' color='text.secondary'>No students assigned.</Typography>
                )}
                {students.map(a => (
                  <Typography key={a.student_id} variant='body2' sx={{ py: 0.25 }}>
                    {a.student?.username || `User #${a.student_id}`}{' '}
                    <Typography component='span' variant='body2' color='text.secondary'>
                      ({a.student?.email || 'no email'})
                    </Typography>
                  </Typography>
                ))}
              </Section>
            )}

            {students === null && (
              <Typography variant='body2' color='text.secondary' sx={{ mt: 2 }}>
                The assigned student list is not visible to student accounts.
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
