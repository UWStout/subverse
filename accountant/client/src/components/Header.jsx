import { AppBar, Box, Toolbar, Typography, Button } from '@mui/material'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from './ThemeToggle'

const NAV_LINKS = [
  { label: 'Users', to: '/users' },
  // Offerings management is restricted to teacher accounts
  { label: 'Offerings', to: '/offerings', roles: ['TEACHER'] }
]

/**
 * Top navigation bar with brand, nav links, and a theme toggle.
 * Links that declare `roles` are only shown to matching user types.
 */
export default function Header () {
  const location = useLocation()
  const { user } = useAuth()

  const visibleLinks = NAV_LINKS.filter(link =>
    !link.roles || (user && link.roles.includes(user.type))
  )

  return (
    <AppBar position='sticky'>
      <Toolbar>
        <Typography variant='h6' component='div' sx={{ flexGrow: 1 }}>
          <Link to='/users' style={{ color: 'inherit', textDecoration: 'none' }}>
            Accountant
          </Link>
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {visibleLinks.map(link => (
            <Button
              key={link.to}
              component={Link}
              to={link.to}
              color='inherit'
              disableRipple
              sx={{
                fontWeight: location.pathname === link.to ? 700 : 400,
                borderBottom: location.pathname === link.to ? '2px solid white' : '2px solid transparent',
                pb: 0.5
              }}
            >
              {link.label}
            </Button>
          ))}

          {user
            ? (
              <Button
                component={Link}
                to='/login'
                color='inherit'
                sx={{
                  fontWeight: 400,
                  borderBottom: '2px solid transparent',
                  pb: 0.5
                }}
              >
                Logout
              </Button>
            )
            : (
              <Button
                component={Link}
                to='/login'
                color='inherit'
                sx={{
                  fontWeight: location.pathname === '/login' ? 700 : 400,
                  borderBottom: location.pathname === '/login' ? '2px solid white' : '2px solid transparent',
                  pb: 0.5
                }}
              >
                Login
              </Button>
            )}

          <ThemeToggle />
        </Box>
      </Toolbar>
    </AppBar>
  )
}
