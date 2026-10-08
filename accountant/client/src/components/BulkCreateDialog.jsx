import { useState, useEffect } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography
} from '@mui/material'
import GroupAddIcon from '@mui/icons-material/GroupAdd'
import { bulkCreateUsers } from '../services/api'

/**
 * Dialog for bulk-creating user accounts from a pasted roster and assigning
 * every account to one project (issue #3).
 *
 * Each entry is "Last, First <email>" (comma = reversed name order) or
 * "First Last <email>"; entries are separated by newlines, semicolons, or
 * commas (auto-detected on the server). The local part of each email becomes
 * the username. Existing accounts that match on both username and email are
 * assigned as-is; unknown people get a password-less account plus an emailed
 * link to set their first password. Conflicts are reported per entry in the
 * summary shown after submitting.
 *
 * Props
 * -----
 * open     – boolean controlling visibility
 * project  – project object from the list (must have an id) or null
 * onClose  – () => void  called when the dialog closes
 * onDone   – (summary) => void  fired after a successful submit
 */
export default function BulkCreateDialog ({ open, project, onClose, onDone }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  // Reset the form each time the dialog opens (possibly for a new project).
  useEffect(() => {
    if (open) {
      setText('')
      setResult(null)
      setError('')
    }
  }, [open, project])

  function handleChange (e) {
    setText(e.target.value)
    // Editing the roster invalidates the previous summary
    if (result) setResult(null)
  }

  async function handleSubmit () {
    if (!project || loading || !text.trim()) return
    setLoading(true)
    setError('')
    try {
      const summary = await bulkCreateUsers(project.id, text)
      setResult(summary)
      onDone?.(summary)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <GroupAddIcon />
          Bulk Add Students{project ? ` – ${project.title}` : ''}
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {!result && (
          <>
            <Typography variant='body2' color='text.secondary' sx={{ mb: 1 }}>
              Paste one entry per person: a name followed by the email address in
              angle brackets. The part of the email before the @ becomes the
              username, and every account is assigned to this project.
            </Typography>
            <Typography variant='body2' sx={{ mb: 2, pl: 1, fontFamily: 'monospace' }}>
              Doe, John &lt;jdoe@my.university.edu&gt;<br />
              Jane Smith &lt;jsmith@my.university.edu&gt;
            </Typography>
            <TextField
              label='Roster'
              value={text}
              onChange={handleChange}
              multiline
              minRows={8}
              fullWidth
              disabled={loading}
              placeholder={'Doe, John <jdoe@my.university.edu>\nSmith, Jane <jsmith@my.university.edu>'}
              helperText='Separate entries with newlines, semicolons, or commas - the separator is detected automatically.'
            />
          </>
        )}

        {error && (
          <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>
        )}

        {result && (
          <>
            <Typography variant='body2' sx={{ mb: 1 }}>
              Processed {result.total} entr{result.total === 1 ? 'y' : 'ies'}: created {result.created}, assigned to the project {(result.assigned ?? 0) + (result.already_assigned ?? 0)}.
            </Typography>

            {(result.created ?? 0) > 0 && (
              <Alert severity='info' sx={{ mb: 1 }}>
                A "set your password" email was sent to each newly created account -
                they can sign in once they set a password.
              </Alert>
            )}

            {(result.errors?.length ?? 0) > 0 && (
              <Alert severity='error' sx={{ mb: 1 }}>
                <Typography component='div' variant='body2' sx={{ fontWeight: 600, mb: 0.5 }}>
                  {result.errors.length} entr{result.errors.length === 1 ? 'y was' : 'ies were'} not processed:
                </Typography>
                {result.errors.map(e => (
                  <Typography key={`${e.index}-${e.raw}`} component='div' variant='body2'>
                    Entry {e.index}: {e.reason}
                  </Typography>
                ))}
              </Alert>
            )}

            {(result.email_failures?.length ?? 0) > 0 && (
              <Alert severity='warning'>
                The set-password email could not be delivered to: {result.email_failures.join(', ')}.
                They can use "Forgot password" instead.
              </Alert>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {loading
          ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mx: 'auto' }}>
              <CircularProgress size={20} />
              <Typography variant='body2'>Processing…</Typography>
            </Box>
          )
          : (
            <>
              {!result && (
                <Button onClick={handleSubmit} disabled={!text.trim()}>Add Students</Button>
              )}
              <Button onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button>
            </>
          )}
      </DialogActions>
    </Dialog>
  )
}
