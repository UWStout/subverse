import { useState } from 'react'
import { Link } from 'react-router-dom'
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
import { requestPasswordReset } from '../services/api'

/**
 * Password-reset request page - the target of the "Forgot your password?"
 * link on the login page. The user enters their username or email address;
 * the server responds identically whether or not an account matches (so the
 * page never reveals which identifiers are registered) and emails a reset
 * link to /reset-password when one is found.
 */
export default function ForgotPassword () {
  const [identifier, setIdentifier] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit (e) {
    e.preventDefault()
    if (!identifier.trim()) return
    setLoading(true)
    setError('')
    try {
      await requestPasswordReset(identifier.trim())
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  let view
  if (sent) {
    view = (
      <>
        <Alert severity='success' sx={{ mb: 2 }}>
          If an account matches <strong>{identifier.trim()}</strong>, a password
          reset email has been sent. Open the link in that email to choose a
          new password.
        </Alert>
        <Button component={Link} to='/login' variant='contained' size='large'>
          Sign In
        </Button>
      </>
    )
  } else {
    view = (
      <>
        <Typography variant='body2' color='text.secondary' sx={{ textAlign: 'center', mb: 2 }}>
          Enter your username or email address and we will send you a link to
          choose a new password.
        </Typography>

        <form onSubmit={handleSubmit}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label='Username or email'
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              fullWidth
              disabled={loading}
              autoFocus
            />

            {error && (
              <Alert severity='error'>{error}</Alert>
            )}

            <Button type='submit' variant='contained' size='large' disabled={loading}>
              {loading ? 'Sending…' : 'Send Reset Link'}
            </Button>
          </Box>
        </form>
      </>
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
