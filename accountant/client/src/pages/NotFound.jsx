import { Box, Button, Typography } from '@mui/material'
import { Link, useLocation } from 'react-router-dom'

/**
 * 404 page for URLs that don't match any known route (e.g. /bubble).
 * Previously the catch-all route silently rendered the Users page instead.
 */
export default function NotFound () {
  const location = useLocation()

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2 }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant='h3' color='primary'>404</Typography>
        <Typography variant='h6' gutterBottom>Page not found</Typography>
        <Typography color='text.secondary' sx={{ mb: 3 }}>
          The page '{location.pathname}' does not exist.
        </Typography>
        <Button component={Link} to='/users' variant='contained'>Go to Users</Button>
      </Box>
    </Box>
  )
}
