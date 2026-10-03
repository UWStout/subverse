import { IconButton, Tooltip } from '@mui/material'
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import { useThemeMode } from '../context/ThemeContext'

/**
 * Reusable button that toggles between light and dark themes.
 */
export default function ThemeToggle () {
  const { mode, toggle } = useThemeMode()

  return (
    <Tooltip title={`Switch to ${mode === 'light' ? 'dark' : 'light'} mode`}>
      <IconButton onClick={toggle} color='inherit' size='small'>
        {mode === 'light' ? <DarkModeIcon /> : <LightModeIcon />}
      </IconButton>
    </Tooltip>
  )
}
