import { createContext, useContext, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchCurrentUser, clearToken } from '../services/api'

const AuthContext = createContext()

export function AuthProvider ({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  // Check for existing token and validate it on initial load
  useEffect(() => {
    async function checkAuth () {
      try {
        const userData = await fetchCurrentUser()
        setUser(userData)
      } catch (err) {
        clearToken()
        setUser(null)
      } finally {
        setLoading(false)
      }
    }
    checkAuth()
  }, [])

  // Logout function
  const logout = () => {
    clearToken()
    setUser(null)
    navigate('/login')
  }

  // Protect routes by redirecting unauthenticated users to login
  const protect = (element) => {
    if (loading) {
      return <div>Loading...</div>
    }
    if (!user) {
      navigate('/login')
      return null
    }
    return element
  }

  return (
    <AuthContext.Provider value={{ user, loading, setUser, logout, protect }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth () {
  return useContext(AuthContext)
}
