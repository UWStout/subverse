import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider } from './context/AuthContext'
import Users from './pages/Users'
import Offerings from './pages/Offerings'
import Projects from './pages/Projects'
import Login from './pages/Login'
import PrivateRoute from './components/PrivateRoute'
import './index.css'

function App () {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path='/login' element={<Login />} />
            <Route element={<PrivateRoute />}>
              <Route path='/users' element={<Users />} />
              <Route path='/offerings' element={<Offerings />} />
              <Route path='/projects' element={<Projects />} />
              <Route path='*' element={<Users />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
