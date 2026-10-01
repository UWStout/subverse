import React, { useState } from 'react'
import {
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  CssBaseline,
  ThemeProvider,
  createTheme,
  Toolbar,
  Typography,
  CircularProgress,
} from '@mui/material'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
})

function App () {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/data')
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position='static'>
        <Toolbar>
          <Typography variant='h6' component='div' sx={{ flexGrow: 1 }}>
            Accountant
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth='sm' sx={{ mt: 4, mb: 4 }}>
        <Card>
          <CardContent>
            <Typography gutterBottom variant='h5' component='div'>
              Welcome
            </Typography>
            <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
              SVN Account Management Tool
            </Typography>

            <Button variant='contained' onClick={fetchData} disabled={loading}>
              {loading ? <CircularProgress size={24} /> : 'Fetch API Data'}
            </Button>

            {error && (
              <Typography color='error' sx={{ mt: 2 }}>
                Error: {error}
              </Typography>
            )}

            {data && (
              <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant='body2'>
                  Status: {data.status}
                </Typography>
                <Typography variant='body2'>
                  Version: {data.version}
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      </Container>
    </ThemeProvider>
  )
}

export default App
