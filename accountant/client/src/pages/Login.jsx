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
import { login } from '../services/api'

/**
 * Login page — exchange username + password for a session token.
 * Intentionally has no "create account" option: accounts are provisioned
 * by teachers and admins via the user management page.
 */
export default function Login () {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Redirect authenticated users to the users page
  useEffect(() => {
    if (user) {
      navigate('/users')
    }
  }, [user, navigate])

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

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2 }}>
      <Card sx={{ width: 400, maxWidth: '100%' }}>
        <CardContent>
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
        </CardContent>
      </Card>
    </Box>
  )
}
