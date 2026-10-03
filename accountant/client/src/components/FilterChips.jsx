import { Chip, Stack, Typography } from '@mui/material'

/**
 * Reusable row of clickable filter chips. The chip matching `value` is
 * highlighted; clicking a chip calls `onChange` with its value.
 *
 * Props
 * -----
 * label   – string (optional), caption rendered before the chips
 * options – array of strings or { value, label } objects
 * value   – currently selected option value
 * onChange – (value) => void
 */
export default function FilterChips ({ label = 'Filter:', options = [], value, onChange }) {
  return (
    <Stack direction='row' spacing={1} sx={{ mb: 2 }}>
      <Typography variant='body2' sx={{ alignSelf: 'center', mr: 1 }}>{label}</Typography>
      {options.map(opt => {
        const o = typeof opt === 'string' ? { value: opt, label: opt } : opt
        const selected = value === o.value
        return (
          <Chip
            key={String(o.value)}
            label={o.label}
            color={selected ? 'primary' : 'default'}
            variant={selected ? 'filled' : 'outlined'}
            onClick={() => onChange(o.value)}
            clickable
          />
        )
      })}
    </Stack>
  )
}
