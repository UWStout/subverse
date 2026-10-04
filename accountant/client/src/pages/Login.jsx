import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  TextField,
  Typography
} from '@mui/material'
import LockIcon from '@mui/icons-material/Lock'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import { login, fetchBootstrapStatus } from '../services/api'
import BootstrapForm from '../components/BootstrapForm'

/**
 * Login page - exchange username + password for a session token.
 * Intentionally has no "create account" option: accounts are provisioned
 * by teachers and admins via the user management page.
 *
 * Exception: when the server has no user accounts yet (first startup), it
 * reports bootstrap mode and this page shows an alternative form for creating
 * the initial ADMIN account using a one-time token from the server logs.
 */
export default function Login () {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Bootstrap mode: null = still checking with the server, true = no accounts exist yet
  const [bootstrapMode, setBootstrapMode] = useState(null)
  const [created, setCreated] = useState(false)

  // Redirect authenticated users to the users page
  useEffect(() => {
    if (user) {
      navigate('/users')
    }
  }, [user, navigate])

  // Ask the server whether the initial admin account still needs creating
  useEffect(() => {
    fetchBootstrapStatus()
      .then(setBootstrapMode)
      .catch(() => setBootstrapMode(false))
  }, [])

  async function handleSubmit (e) {
    e.preventDefault()
    if (!username.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      await login(username, password)
      navigate('/users')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const showBootstrap = bootstrapMode === true && !created

  // Pick the view to render: bootstrap form, brief loading state, or sign-in
  let view
  if (showBootstrap) {
    view = (
      <>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, mb: 3 }}>
          <AdminPanelSettingsIcon color='primary' fontSize='large' />
          <Typography variant='h5'>Create Initial Admin Account</Typography>
          <Typography variant='body2' color='text.secondary' sx={{ textAlign: 'center' }}>
            This server has no accounts yet. Create the root admin account
            using the one-time token printed in the server logs.
          </Typography>
        </Box>

        <BootstrapForm onCreated={() => setCreated(true)} />
      </>
    )
  } else if (bootstrapMode === null) {
    view = (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <Typography color='text.secondary'>Loading…</Typography>
      </Box>
    )
  } else {
    view = (
      <>
        {created && (
          <Alert severity='success' sx={{ mb: 2 }}>
            Initial admin account created - you can now sign in.
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, mb: 3 }}>
          <LockIcon color='primary' fontSize='large' />
          <Typography variant='h5'>Sign In</Typography>
        </Box>

        <form onSubmit={handleSubmit}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label='Username'
              value={username}
              onChange={e => setUsername(e.target.value)}
              fullWidth
              disabled={loading}
              autoFocus
            />

            <TextField
              label='Password'
              type='password'
              value={password}
              onChange={e => setPassword(e.target.value)}
              fullWidth
              disabled={loading}
            />

            {error && (
              <Alert severity='error'>{error}</Alert>
            )}

            <Button type='submit' variant='contained' size='large' disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </Button>
          </Box>
        </form>

        <Typography variant='body2' color='text.secondary' sx={{ mt: 2, textAlign: 'center' }}>
          Accounts are created by your teacher or admin.
        </Typography>
      </>
    )
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2 }}>
      <Card sx={{ width: showBootstrap ? 480 : 400, maxWidth: '100%' }}>
        <CardContent>
          {view}
        </CardContent>
      </Card>
    </Box>
  )
}
