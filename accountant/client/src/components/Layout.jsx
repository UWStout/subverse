import { Box, Container, CssBaseline } from '@mui/material'
import Header from './Header'

/**
 * Page-level layout: fixed header + scrollable content area.
 */
export default function Layout ({ children }) {
  return (
    <>
      <CssBaseline />
      <Header />
      <Container maxWidth='lg' sx={{ mt: 4, mb: 6 }}>
        <Box>{children}</Box>
      </Container>
    </>
  )
}
