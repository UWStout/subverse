import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  TextField
} from '@mui/material'
import { createBootstrapAccount } from '../services/api'

/**
 * Bootstrap form - shown in place of the sign-in form when the server has no
 * user accounts yet. Collects the initial ADMIN account details plus the
 * one-time bootstrap token that the server printed to its logs at startup.
 *
 * Props
 * -----
 * onCreated – (user) => void  called with the created user after success
 */
export default function BootstrapForm ({ onCreated }) {
  // Local form state
  const [username, setUsername] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [token, setToken] = useState('')

  // UI state
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)

  /* ---- Validation ---- */

  function validate () {
    const errs = {}
    if (!username.trim()) errs.username = 'Username is required'
    if (!email.trim()) errs.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Invalid email format'
    if (!password) errs.password = 'Password is required'
    if (confirmPassword !== password) errs.confirmPassword = 'Passwords do not match'
    if (!token.trim()) errs.token = 'Bootstrap token is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  /* ---- Submit handler ---- */

  async function handleSubmit (e) {
    e.preventDefault()
    if (!validate()) return
    setLoading(true)
    setServerError('')

    try {
      const data = await createBootstrapAccount({
        token: token.trim(),
        username: username.trim(),
        email,
        password,
        firstName,
        lastName
      })
      onCreated(data.user)
    } catch (err) {
      setServerError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label='Username'
          value={username}
          onChange={e => setUsername(e.target.value)}
          error={!!errors.username}
          helperText={errors.username}
          fullWidth
          disabled={loading}
          autoFocus
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
          helperText={errors.password}
          fullWidth
          disabled={loading}
        />

        <TextField
          label='Confirm Password'
          type='password'
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          error={!!errors.confirmPassword}
          helperText={errors.confirmPassword}
          fullWidth
          disabled={loading}
        />

        <TextField
          label='Bootstrap Token'
          value={token}
          onChange={e => setToken(e.target.value)}
          error={!!errors.token}
          helperText={errors.token}
          fullWidth
          disabled={loading}
          multiline
          minRows={2}
        />

        <Alert severity='info'>
          Find the one-time bootstrap token in the server logs. It expires after
          5 minutes, can only be used once, and is stored nowhere else.
        </Alert>

        {serverError && (
          <Alert severity='error'>{serverError}</Alert>
        )}

        <Button type='submit' variant='contained' size='large' disabled={loading}>
          {loading ? 'Creating account…' : 'Create Admin Account'}
        </Button>
      </Box>
    </form>
  )
}
