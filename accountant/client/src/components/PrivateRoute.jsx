import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * Route guard for authenticated pages. While the session is being
 * verified a loading placeholder is shown; unauthenticated users are
 * redirected to /login.
 */
const PrivateRoute = () => {
  const { user, loading } = useAuth()

  if (loading) {
    return <div>Loading...</div>
  }

  return user ? <Outlet /> : <Navigate to='/login' replace />
}

export default PrivateRoute
