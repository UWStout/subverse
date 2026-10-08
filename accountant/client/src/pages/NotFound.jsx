import { Box, Button, Typography } from '@mui/material'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homePathFor } from '../components/Header'

/**
 * 404 page for URLs that don't match any known route (e.g. /bubble).
 * Previously the catch-all route silently rendered the Users page instead.
 * The recovery button points at the user's home page - students go to
 * Projects, everyone else to Users.
 */
export default function NotFound () {
  const location = useLocation()
  const { user } = useAuth()
  const isStudent = !!user && user.type === 'STUDENT'

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2 }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant='h3' color='primary'>404</Typography>
        <Typography variant='h6' gutterBottom>Page not found</Typography>
        <Typography color='text.secondary' sx={{ mb: 3 }}>
          The page '{location.pathname}' does not exist.
        </Typography>
        <Button component={Link} to={homePathFor(user)} variant='contained'>
          {isStudent ? 'Go to Projects' : 'Go to Users'}
        </Button>
      </Box>
    </Box>
  )
}
