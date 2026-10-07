import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography
} from '@mui/material'
import { fetchUser } from '../services/api'

const TYPE_COLORS = {
  STUDENT: 'default',
  TEACHER: 'primary',
  ADMIN: 'error'
}

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

/** "GDD 200" style label from a joined class object. */
function classLabel (cls) {
  return cls ? `${cls.subject} ${cls.number}`.trim() : ''
}

/**
 * Read-only dialog showing the full details of one user, joined one level
 * deep: the classes this user teaches (teachers / admins) and the projects
 * they are assigned to (students), each with its class / term / section.
 *
 * Props
 * -----
 * open    – boolean controlling visibility
 * user    – user object from the list (must have an id) or null
 * onClose – () => void  called when the dialog closes
 */
export default function UserDetailsDialog ({ open, user, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Fetch fresh details whenever the dialog opens for a (new) user.
  useEffect(() => {
    if (!open || !user) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    setData(null)
    fetchUser(user.id)
      .then(result => { if (!cancelled) setData(result) })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, user])

  const taught = data?.taught_offerings || []
  const assignments = data?.assignments || []

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>User Details</DialogTitle>

      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {!loading && error && <Alert severity='error'>{error}</Alert>}

        {!loading && !error && data && (
          <Box>
            <Field label='Username'>{data.username}</Field>
            <Field label='Name'>{[data.first_name, data.last_name].filter(Boolean).join(' ') || '—'}</Field>
            <Field label='Email'>{data.email}</Field>
            <Field label='Type'>
              <Chip label={data.type} color={TYPE_COLORS[data.type] || 'default'} size='small' />
            </Field>

            {taught.length > 0 && (
              <Section title={`Teaches (${taught.length})`}>
                {taught.map(o => (
                  <Typography key={o.id} variant='body2' sx={{ py: 0.25 }}>
                    {classLabel(o.class)} – {o.class?.title || ''}{' '}
                    <Typography component='span' variant='body2' color='text.secondary'>
                      ({o.term}, section {o.section})
                    </Typography>
                  </Typography>
                ))}
              </Section>
            )}

            {assignments.length > 0 && (
              <Section title={`Assigned Projects (${assignments.length})`}>
                {assignments.map(a => {
                  const p = a.project || {}
                  const cls = p.offering?.class
                  return (
                    <Typography key={a.project_id} variant='body2' sx={{ py: 0.25 }}>
                      {p.title || `Project #${p.id}`}{' '}
                      <Typography component='span' variant='body2' color='text.secondary'>
                        ({classLabel(cls)}{cls ? `, ${p.offering.term}, section ${p.offering.section}` : ''})
                      </Typography>
                    </Typography>
                  )
                })}
              </Section>
            )}

            {taught.length === 0 && assignments.length === 0 && (
              <Typography variant='body2' color='text.secondary' sx={{ mt: 2 }}>
                No offerings taught and no project assignments.
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
