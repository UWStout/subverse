import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider } from './context/AuthContext'
// Login is the landing page for anonymous visitors, so it stays in the
// initial bundle; every other page is lazy-loaded as its own chunk to keep
// the main bundle small (see the Vite >500 kB chunk warning).
import Login from './pages/Login'
import PrivateRoute from './components/PrivateRoute'
import { useAuth } from './context/AuthContext'
import { homePathFor } from './components/Header'
import './index.css'

const Users = lazy(() => import('./pages/Users'))
const Offerings = lazy(() => import('./pages/Offerings'))
const Projects = lazy(() => import('./pages/Projects'))
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const NotFound = lazy(() => import('./pages/NotFound'))

/**
 * Root is an alias for the user's home page (guards apply as usual):
 * students go to /projects, everyone else to /users. Waits for the session
 * check so a refreshing student isn't bounced onto the users page first.
 */
function HomeRedirect () {
  const { user, loading } = useAuth()

  if (loading) {
    return <div>Loading...</div>
  }
  return <Navigate to={homePathFor(user)} replace />
}

function App () {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<div>Loading...</div>}>
            <Routes>
              {/* Root is an alias for the home page (guards apply as usual) */}
              <Route path='/' element={<HomeRedirect />} />
              <Route path='/login' element={<Login />} />
              {/* Public: target of the emailed verification link (?token=...) */}
              <Route path='/verify' element={<VerifyEmail />} />
              {/* Public: forgot-password request + the emailed reset link (?token=...) */}
              <Route path='/forgot-password' element={<ForgotPassword />} />
              <Route path='/reset-password' element={<ResetPassword />} />
              <Route element={<PrivateRoute />}>
                <Route path='/users' element={<Users />} />
                <Route path='/offerings' element={<Offerings />} />
                <Route path='/projects' element={<Projects />} />
              </Route>
              {/* Unknown paths get a real 404 page instead of silently landing on Users */}
              <Route path='*' element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
