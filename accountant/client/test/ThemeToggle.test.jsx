import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ThemeToggle from '../src/components/ThemeToggle'
import { ThemeProvider } from '../src/context/ThemeContext'

describe('ThemeToggle', () => {
  let user

  beforeEach(async () => {
    vi.clearAllMocks()
    user = await userEvent.setup()
  })

  it('starts in light mode and switches to dark on click', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    )

    // Light mode shows the "switch to dark" icon
    expect(screen.getByTestId('DarkModeIcon')).toBeInTheDocument()
    expect(screen.queryByTestId('LightModeIcon')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button'))

    // Dark mode shows the "switch to light" icon
    expect(await screen.findByTestId('LightModeIcon')).toBeInTheDocument()
    expect(screen.queryByTestId('DarkModeIcon')).not.toBeInTheDocument()
  })

  it('toggles back to light mode on a second click', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    )

    await user.click(screen.getByRole('button'))
    await screen.findByTestId('LightModeIcon')

    await user.click(screen.getByRole('button'))

    expect(await screen.findByTestId('DarkModeIcon')).toBeInTheDocument()
  })

  it('throws when used outside of a ThemeProvider', () => {
    expect(() => render(<ThemeToggle />)).toThrowError(
      'useThemeMode must be used within ThemeProvider'
    )
  })
})
