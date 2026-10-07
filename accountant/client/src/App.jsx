import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider } from './context/AuthContext'
import Users from './pages/Users'
import Offerings from './pages/Offerings'
import Projects from './pages/Projects'
import Login from './pages/Login'
import VerifyEmail from './pages/VerifyEmail'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import PrivateRoute from './components/PrivateRoute'
import NotFound from './pages/NotFound'
import './index.css'

function App () {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Root is an alias for the home page (guards apply as usual) */}
            <Route path='/' element={<Navigate to='/users' replace />} />
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
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
