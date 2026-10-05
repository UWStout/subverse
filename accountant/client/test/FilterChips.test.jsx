import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import FilterChips from '../src/components/FilterChips'

describe('FilterChips', () => {
  let user

  beforeEach(async () => {
    vi.clearAllMocks()
    user = await userEvent.setup()
  })

  it('renders a chip per option with the given label', () => {
    render(
      <FilterChips
        label='Term:'
        options={[{ value: '*', label: 'All' }, { value: 'FALL25', label: 'FALL25' }]}
        value='*'
        onChange={() => {}}
      />
    )

    expect(screen.getByText('Term:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'FALL25' })).toBeInTheDocument()
  })

  it('accepts plain strings as options (value and label)', async () => {
    const onChange = vi.fn()
    render(<FilterChips options={['A', 'B']} value='A' onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'B' }))

    expect(onChange).toHaveBeenCalledWith('B')
  })

  it('reports the clicked option and highlights the selected one', async () => {
    const onChange = vi.fn()
    render(
      <FilterChips
        options={[{ value: '*', label: 'All' }, { value: 'X', label: 'Term X' }]}
        value='*'
        onChange={onChange}
      />
    )

    // The selected chip is rendered filled, the others outlined
    expect(screen.getByRole('button', { name: 'All' })).toHaveClass('MuiChip-filled')
    expect(screen.getByRole('button', { name: 'Term X' })).toHaveClass('MuiChip-outlined')

    await user.click(screen.getByRole('button', { name: 'Term X' }))

    expect(onChange).toHaveBeenCalledWith('X')
  })
})
