import { useState } from 'react'
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import LogoutIcon from '@mui/icons-material/Logout'
import PersonIcon from '@mui/icons-material/Person'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchCurrentUser } from '../services/api'
import ThemeToggle from './ThemeToggle'
import UserForm from './UserForm'

// The home page for the brand link and root redirect: students land on
// Projects (their read-only view of assigned projects), everyone else on
// Users. Students have no business on the Users page - the server denies
// them the user list - so they manage their own account via the avatar menu.
export function homePathFor (user) {
  return user && user.type === 'STUDENT' ? '/projects' : '/users'
}

const NAV_LINKS = [
  // Students never see the Users page; they edit their own account through
  // the avatar menu's "Edit Account" option instead.
  { label: 'Users', to: '/users', exceptRoles: ['STUDENT'] },
  // Offerings is available to every role except students
  { label: 'Offerings', to: '/offerings', exceptRoles: ['STUDENT'] },
  // Projects is visible to every role; students get a read-only view of
  // their assigned projects (the server restricts what they can see)
  { label: 'Projects', to: '/projects' }
]

/**
 * Top navigation bar with brand, nav links, an account menu, and a theme
 * toggle. Links that declare `roles` are only shown to matching user types;
 * links that declare `exceptRoles` are hidden from those user types.
 *
 * Authenticated users get an avatar button (showing their initials) that
 * opens a context menu with "Edit Account" (opens the user form in a modal,
 * scoped to their own record) and "Logout".
 */
export default function Header () {
  const location = useLocation()
  const { user, logout, setUser } = useAuth()

  // Account menu state
  const [menuAnchor, setMenuAnchor] = useState(null)
  // Self-service account edit modal
  const [editOpen, setEditOpen] = useState(false)

  const visibleLinks = NAV_LINKS.filter(link => {
    if (link.roles) return user && link.roles.includes(user.type)
    if (link.exceptRoles) return user && !link.exceptRoles.includes(user.type)
    return true
  })

  // Avatar initials: first letter of first + last name (falls back to a
  // generic person icon when the account has no names on file).
  const initials = user
    ? `${(user.first_name || '').charAt(0)}${(user.last_name || '').charAt(0)}`.toUpperCase()
    : ''

  function openSelfEdit () {
    setMenuAnchor(null)
    setEditOpen(true)
  }

  // After a successful self-update, refresh the auth context so the avatar
  // (and anything else reading `user`) reflects the new profile data.
  async function handleSelfEditSubmit () {
    try {
      setUser(await fetchCurrentUser())
    } catch {
      // Stale/invalid token - the next navigation or page load re-syncs.
    }
  }

  return (
    <AppBar position='sticky'>
      <Toolbar>
        <Typography variant='h6' component='div' sx={{ flexGrow: 1 }}>
          <Link to={homePathFor(user)} style={{ color: 'inherit', textDecoration: 'none' }}>
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
              <>
                <Tooltip title={user.username}>
                  <IconButton
                    size='small'
                    onClick={e => setMenuAnchor(e.currentTarget)}
                    aria-label='Account menu'
                    sx={{ ml: 0.5 }}
                  >
                    <Avatar sx={{ width: 32, height: 32 }}>
                      {initials || <PersonIcon />}
                    </Avatar>
                  </IconButton>
                </Tooltip>

                <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
                  <MenuItem onClick={openSelfEdit}>
                    <EditIcon fontSize='small' sx={{ mr: 1 }} />
                    Edit Account
                  </MenuItem>
                  <Divider />
                  {/* Real button behavior (not a Link): logout must clear the
                      token and auth state, not just navigate - otherwise the
                      Login page's "already authenticated" effect bounces us
                      right back. */}
                  <MenuItem onClick={() => { setMenuAnchor(null); logout() }}>
                    <LogoutIcon fontSize='small' sx={{ mr: 1 }} />
                    Logout
                  </MenuItem>
                </Menu>
              </>
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

      {/* Self-service account edit - reuses the user form in a modal, scoped
          to the current user's own record */}
      {user && (
        <UserForm
          open={editOpen}
          user={user}
          selfEdit
          onClose={() => setEditOpen(false)}
          onSubmit={handleSelfEditSubmit}
        />
      )}
    </AppBar>
  )
}
