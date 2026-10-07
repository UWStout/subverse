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
import { fetchOffering } from '../services/api'

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
 * Read-only dialog showing the full details of one offering, joined one
 * level deep: its class, its teacher and all projects belonging to it.
 *
 * Props
 * -----
 * open      – boolean controlling visibility
 * offering  – offering object from the list (must have an id) or null
 * onClose   – () => void  called when the dialog closes
 */
export default function OfferingDetailsDialog ({ open, offering, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Fetch fresh details whenever the dialog opens for a (new) offering.
  useEffect(() => {
    if (!open || !offering) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    setData(null)
    fetchOffering(offering.id)
      .then(result => { if (!cancelled) setData(result) })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, offering])

  const projects = data?.projects || []

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>Offering Details</DialogTitle>

      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {!loading && error && <Alert severity='error'>{error}</Alert>}

        {!loading && !error && data && (
          <Box>
            <Field label='Class'>
              {data.class ? `${data.class.subject} ${data.class.number} – ${data.class.title}` : '—'}
            </Field>
            <Field label='Term'>{data.term}</Field>
            <Field label='Section'>{data.section}</Field>
            <Field label='Teacher'>
              {data.teacher ? `${data.teacher.username} (${data.teacher.email})` : '—'}
            </Field>

            <Section title={`Projects (${projects.length})`}>
              {projects.length === 0 && (
                <Typography variant='body2' color='text.secondary'>No projects in this offering.</Typography>
              )}
              {projects.map(p => (
                <Box key={p.id} sx={{ py: 0.5 }}>
                  <Typography variant='body2'>{p.title}</Typography>
                  {(p.git_url || p.subversion_url) && (
                    <Typography variant='caption' color='text.secondary' sx={{ wordBreak: 'break-all' }}>
                      {p.git_url || p.subversion_url}
                    </Typography>
                  )}
                </Box>
              ))}
            </Section>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
