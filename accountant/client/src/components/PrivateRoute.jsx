import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isEmailVerified } from '../services/api'

/**
 * Route guard for authenticated pages. While the session is being verified a
 * loading placeholder is shown; unauthenticated users are redirected to
 * /login. Authenticated users whose email address has not been verified yet
 * (provisional accounts) are redirected to /verify - the server denies every
 * protected endpoint for them until they click the emailed verification link.
 */
const PrivateRoute = () => {
  const { user, loading } = useAuth()

  if (loading) {
    return <div>Loading...</div>
  }

  if (!user) {
    return <Navigate to='/login' replace />
  }

  if (!isEmailVerified(user)) {
    return <Navigate to='/verify' replace />
  }

  return <Outlet />
}

export default PrivateRoute
