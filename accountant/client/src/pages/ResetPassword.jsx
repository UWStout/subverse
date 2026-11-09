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
import { resetPassword, renewResetToken } from '../services/api'

/**
 * Password-reset page - the target of the link in the password-reset email.
 *
 * With a `?token=` query param (the normal case: the user clicked the emailed
 * link) they are prompted for a new password and confirmation; on submit the
 * single-use token is exchanged for the new password. Without one, the page
 * explains the situation and offers a way back to sign-in.
 *
 * With `?first_time=true` (sent in the "set your password" email that
 * bulk-created accounts receive) the wording switches from "reset your
 * password" to first-time-setup phrasing. The param is cosmetic only - the
 * token is what authorizes anything.
 *
 * Reset links are only valid for a short time, so an expired token is common
 * enough to get its own state: instead of a dead-end error, the page offers
 * to immediately reissue the email (POST /auth/renew-reset-token with the
 * stale token) or to fall back to the forgot-password page and enter a
 * username manually.
 */
export default function ResetPassword () {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  // Cosmetic only (set by the "set your password" email for bulk-created
  // accounts): switches the page wording from "reset" to "first-time setup".
  const firstTime = searchParams.get('first_time') === 'true'

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [reset, setReset] = useState(false)
  // Expired-token state: the link is stale, so offer to reissue a new one
  // instead of showing a dead-end error.
  const [expired, setExpired] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [renewed, setRenewed] = useState(false)
  const [renewError, setRenewError] = useState('')

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
      if (err.code === 'RESET_TOKEN_EXPIRED') {
        // The link is stale - switch to the expired view, which offers a
        // fresh link, rather than leaving the (useless) form on screen.
        setExpired(true)
      } else {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleRenew () {
    setRenewing(true)
    setRenewError('')
    try {
      await renewResetToken(token)
      setRenewed(true)
    } catch (err) {
      setRenewError(err.message)
    } finally {
      setRenewing(false)
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
          {firstTime
            ? 'Your password has been set. You can now sign in with it.'
            : 'Your password has been reset successfully. You can now sign in with your new password.'}
        </Alert>
        <Button component={Link} to='/login' variant='contained' size='large'>
          Sign In
        </Button>
      </>
    )
  } else if (expired) {
    view = renewed
      ? (
        <>
          <Alert severity='success' sx={{ mb: 2 }}>
            A new password reset email has been sent. Open the newest link from
            your email to continue - any older links are no longer valid.
          </Alert>
          <Button component={Link} to='/login' variant='contained' size='large'>
            Sign In
          </Button>
        </>
      )
      : (
        <>
          <Alert severity='warning' sx={{ mb: 2 }}>
            This password reset link has expired. Reset links are only valid
            for a short time for security reasons.
          </Alert>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {renewError && (
              <Alert severity='error'>{renewError}</Alert>
            )}
            <Button onClick={handleRenew} variant='contained' size='large' disabled={renewing}>
              {renewing ? 'Sending…' : 'Send Me a New Link'}
            </Button>
            <Typography variant='body2' color='text.secondary' sx={{ textAlign: 'center' }}>
              Or{' '}<Link to='/forgot-password'>request a new link manually</Link>{' '}
              by entering your username or email address.
            </Typography>
          </Box>
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
            {loading ? (firstTime ? 'Setting…' : 'Resetting…') : (firstTime ? 'Set Password' : 'Reset Password')}
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
            <Typography variant='h5'>{firstTime ? 'Set Your Password' : 'Reset Your Password'}</Typography>
            {firstTime && (
              <Typography variant='body2' color='text.secondary' sx={{ textAlign: 'center' }}>
                You are setting up your account for the first time. Choose the
                password you will use to sign in from now on.
              </Typography>
            )}
          </Box>
          {view}
        </CardContent>
      </Card>
    </Box>
  )
}
