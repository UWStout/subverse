import { createContext, useContext, useMemo, useState } from 'react'
import { createTheme, ThemeProvider as MUIThemeProvider } from '@mui/material'

const ThemeContext = createContext(null)

export function useThemeMode () {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useThemeMode must be used within ThemeProvider')
  return ctx
}

/**
 * Wraps MUIThemeProvider and exposes mode + toggle via context.
 */
export function ThemeProvider ({ children }) {
  const [mode, setMode] = useState('light')

  const toggle = () => setMode(m => (m === 'light' ? 'dark' : 'light'))

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          primary: { main: '#1976d2' },
          secondary: { main: '#dc004e' }
        }
      }),
    [mode]
  )

  const value = useMemo(() => ({ mode, toggle }), [mode, toggle])

  return (
    <ThemeContext.Provider value={value}>
      <MUIThemeProvider theme={theme}>{children}</MUIThemeProvider>
    </ThemeContext.Provider>
  )
}
