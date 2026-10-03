import { useState, useEffect } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Alert
} from '@mui/material'
import { checkAvailability, createUser, updateUser } from '../services/api'

const USER_TYPES = ['STUDENT', 'TEACHER', 'ADMIN']

/**
 * Reusable user form wrapped in a Dialog.
 *
 * Props
 * -----
 * open          – boolean controlling visibility
 * user          – existing user object (edit mode) or undefined (create mode)
 * onClose       – () => void  called when dialog closes
 * onSubmit      – () => void  callback fired after successful create / update
 */
export default function UserForm ({ open, user, onClose, onSubmit }) {
  const isEdit = !!user

  // Local form state
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [type, setType] = useState('STUDENT')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  // UI state
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)

  // Populate fields when switching between create / edit
  useEffect(() => {
    if (user) {
      setUsername(user.username || '')
      setEmail(user.email || '')
      setFirstName(user.first_name || '')
      setLastName(user.last_name || '')
      setType(user.type || 'STUDENT')
      setPassword('')
    } else {
      setUsername('')
      setEmail('')
      setFirstName('')
      setLastName('')
      setPassword('')
      setType('STUDENT')
    }
    setErrors({})
    setServerError('')
  }, [user, open])

  /* ---- Validation ---- */

  function validate () {
    const errs = {}
    if (!username.trim()) errs.username = 'Username is required'
    if (!email.trim()) errs.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Invalid email format'
    // Password is required on create; optional on edit (blank keeps current)
    if (!isEdit && !password) errs.password = 'Password is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  /* ---- Availability check ---- */

  /** Returns false when a conflict was found (and reported in field errors). */
  async function checkAvail () {
    const result = await checkAvailability(username, email)
    if (!result.available) {
      const conflictFields = result.conflicts || []
      const errs = {}
      if (conflictFields.includes('username')) errs.username = 'Username already in use'
      if (conflictFields.includes('email')) errs.email = 'Email already in use'
      setErrors(prev => ({ ...prev, ...errs }))
      return false
    }
    return true
  }

  /* ---- Submit handler ---- */

  async function handleSubmit () {
    if (!validate()) return
    setLoading(true)
    setServerError('')

    try {
      // For create mode, verify availability first (skip submit on conflict)
      if (!isEdit && !(await checkAvail())) {
        setLoading(false)
        return
      }

      const payload = { username, email, password, type, firstName, lastName }

      if (isEdit) {
        await updateUser(user.id, payload)
      } else {
        await createUser(payload)
      }

      onSubmit()
      onClose()
    } catch (err) {
      setServerError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onClose={!loading ? onClose : undefined} maxWidth='sm' fullWidth>
      <DialogTitle>{isEdit ? 'Edit User' : 'Create User'}</DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label='Username'
            value={username}
            onChange={e => setUsername(e.target.value)}
            error={!!errors.username}
            helperText={errors.username}
            fullWidth
            disabled={loading}
          />

          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label='First Name'
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              fullWidth
              disabled={loading}
            />

            <TextField
              label='Last Name'
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              fullWidth
              disabled={loading}
            />
          </Box>

          <TextField
            label='Email'
            type='email'
            value={email}
            onChange={e => setEmail(e.target.value)}
            error={!!errors.email}
            helperText={errors.email}
            fullWidth
            disabled={loading}
          />

          <TextField
            label='Password'
            type='password'
            value={password}
            onChange={e => setPassword(e.target.value)}
            error={!!errors.password}
            helperText={errors.password || (isEdit ? 'Leave blank to keep current password' : '')}
            fullWidth
            disabled={loading}
          />

          <FormControl fullWidth error={!!errors.type}>
            <InputLabel id='user-type-label'>Type</InputLabel>
            <Select
              labelId='user-type-label'
              value={type}
              label='Type'
              onChange={e => setType(e.target.value)}
              disabled={loading}
            >
              {USER_TYPES.map(t => (
                <MenuItem key={t} value={t}>{t}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {serverError && (
            <Alert severity='error' sx={{ mt: 1 }}>{serverError}</Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant='contained' onClick={handleSubmit} disabled={loading}>
          {isEdit ? 'Save Changes' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
