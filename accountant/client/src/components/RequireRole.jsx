import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * Reusable role gate: renders `children` only when the logged-in user has
 * one of the allowed roles. Unauthenticated users are sent to /login and
 * authenticated users with a different role fall back to /users.
 *
 * Props
 * -----
 * roles    – array of allowed UserType values, e.g. ['TEACHER']
 * children – the protected content
 */
export default function RequireRole ({ roles = [], children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <div>Loading...</div>
  }
  if (!user) {
    return <Navigate to='/login' replace />
  }
  if (!roles.includes(user.type)) {
    return <Navigate to='/users' replace />
  }
  return children
}
