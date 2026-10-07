import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Typography
} from '@mui/material'
import MailOutlinedIcon from '@mui/icons-material/MailOutlined'
import { verifyEmail, resendVerification, fetchCurrentUser, isEmailVerified } from '../services/api'

/**
 * Email verification page - the target of the link in the verification email.
 *
 * With a `?token=` query param (the normal case: the user clicked the emailed
 * link) the token is exchanged for a verified account automatically on load.
 * Without one, the page explains the situation based on the session: an
 * unverified user is told to check their inbox and can request a fresh link;
 * a verified user is pointed back into the app. Unverified sessions are
 * redirected here by PrivateRoute whenever they try to open a protected page.
 */
export default function VerifyEmail () {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const { user, loading: authLoading, setUser } = useAuth()

  // Token-exchange state (only used when a token is present)
  const [verifying, setVerifying] = useState(!!token)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')

  // The last token already exchanged for this mount. The verification token
  // is single-use, so the request must go out at most once per token even
  // when React re-runs the effect (StrictMode double-invokes effects in dev).
  const requestedRef = useRef(null)

  // "Resend link" state (logged-in users whose address is still unverified)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [resendError, setResendError] = useState('')

  // Exchange the emailed token exactly once per page load. React StrictMode
  // (development) double-invokes effects: without the ref guard, the second
  // call would arrive after the first already consumed the single-use token
  // and report a false "Invalid verification token" error even though the
  // verification actually succeeded.
  useEffect(() => {
    if (!token || requestedRef.current === token) return undefined
    requestedRef.current = token

    verifyEmail(token)
      .then(async () => {
        setVerified(true)
        // If this browser holds a session, refresh it so the route guards see
        // the verified status immediately (the server lifts it at once).
        if (user) {
          try {
            setUser(await fetchCurrentUser())
          } catch {
            /* stale or missing session - stay on the page */
          }
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setVerifying(false))
  }, [token])

  async function handleResend () {
    setResending(true)
    setResent(false)
    setResendError('')
    try {
      await resendVerification()
      setResent(true)
    } catch (err) {
      setResendError(err.message)
    } finally {
      setResending(false)
    }
  }

  // Resend control, shown to logged-in users whose address is still unverified.
  const resendSection = user && !isEmailVerified(user)
    ? (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
        {resent && (
          <Alert severity='success'>A new verification email has been sent.</Alert>
        )}
        {resendError && (
          <Alert severity='error'>{resendError}</Alert>
        )}
        <Button variant='outlined' onClick={handleResend} disabled={resending}>
          {resending ? 'Sending…' : 'Resend Verification Email'}
        </Button>
      </Box>
    )
    : null

  let view
  if (token) {
    if (verifying) {
      view = (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )
    } else if (verified) {
      view = (
        <>
          <Alert severity='success' sx={{ mb: 2 }}>
            Your email address has been verified successfully.
          </Alert>
          <Button component={Link} to='/login' variant='contained' size='large'>
            Sign In
          </Button>
        </>
      )
    } else {
      view = (
        <>
          <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>
          {resendSection}
          <Button component={Link} to='/login' variant='contained' size='large'>
            Sign In
          </Button>
        </>
      )
    }
  } else if (authLoading) {
    view = (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    )
  } else if (user && !isEmailVerified(user)) {
    view = (
      <>
        <Alert severity='info' sx={{ mb: 2 }}>
          A verification email has been sent to <strong>{user.email}</strong>.
          Open that email and click the link to verify your address - until you
          do, this account cannot use the app.
        </Alert>
        {resendSection}
      </>
    )
  } else if (user) {
    view = (
      <>
        <Alert severity='success' sx={{ mb: 2 }}>
          Your email address is already verified.
        </Alert>
        <Button component={Link} to='/users' variant='contained' size='large'>
          Go to Users
        </Button>
      </>
    )
  } else {
    view = (
      <>
        <Alert severity='warning' sx={{ mb: 2 }}>
          No verification link was provided. Open the link from your
          verification email, or sign in and request a new one.
        </Alert>
        <Button component={Link} to='/login' variant='contained' size='large'>
          Sign In
        </Button>
      </>
    )
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2 }}>
      <Card sx={{ width: 440, maxWidth: '100%' }}>
        <CardContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, mb: 3 }}>
            <MailOutlinedIcon color='primary' fontSize='large' />
            <Typography variant='h5'>Verify Your Email Address</Typography>
          </Box>
          {view}
        </CardContent>
      </Card>
    </Box>
  )
}
