import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  TextField,
  Typography
} from '@mui/material'
import LockResetIcon from '@mui/icons-material/LockReset'
import { resetPassword } from '../services/api'

/**
 * Password-reset page - the target of the link in the password-reset email.
 *
 * With a `?token=` query param (the normal case: the user clicked the emailed
 * link) they are prompted for a new password and confirmation; on submit the
 * single-use token is exchanged for the new password. Without one, the page
 * explains the situation and offers a way back to sign-in.
 */
export default function ResetPassword () {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [reset, setReset] = useState(false)

  async function handleSubmit (e) {
    e.preventDefault()
    const fieldErrors = {}
    if (!password) fieldErrors.password = 'Password is required'
    if (confirmPassword !== password) fieldErrors.confirmPassword = 'Passwords do not match'
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) return

    setLoading(true)
    setError('')
    try {
      await resetPassword(token, password)
      setReset(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  let view
  if (!token) {
    view = (
      <>
        <Alert severity='warning' sx={{ mb: 2 }}>
          No reset link was provided. Open the link from your password-reset
          email, or sign in and request a new one.
        </Alert>
        <Button component={Link} to='/login' variant='contained' size='large'>
          Sign In
        </Button>
      </>
    )
  } else if (reset) {
    view = (
      <>
        <Alert severity='success' sx={{ mb: 2 }}>
          Your password has been reset successfully. You can now sign in with
          your new password.
        </Alert>
        <Button component={Link} to='/login' variant='contained' size='large'>
          Sign In
        </Button>
      </>
    )
  } else {
    view = (
      <form onSubmit={handleSubmit}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label='New Password'
            type='password'
            value={password}
            onChange={e => setPassword(e.target.value)}
            fullWidth
            disabled={loading}
            error={!!errors.password}
            helperText={errors.password}
            autoFocus
          />

          <TextField
            label='Confirm New Password'
            type='password'
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            fullWidth
            disabled={loading}
            error={!!errors.confirmPassword}
            helperText={errors.confirmPassword}
          />

          {error && (
            <Alert severity='error'>{error}</Alert>
          )}

          <Button type='submit' variant='contained' size='large' disabled={loading}>
            {loading ? 'Resetting…' : 'Reset Password'}
          </Button>
        </Box>
      </form>
    )
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2 }}>
      <Card sx={{ width: 440, maxWidth: '100%' }}>
        <CardContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, mb: 3 }}>
            <LockResetIcon color='primary' fontSize='large' />
            <Typography variant='h5'>Reset Your Password</Typography>
          </Box>
          {view}
        </CardContent>
      </Card>
    </Box>
  )
}
