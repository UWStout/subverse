import { CircularProgress, TableCell, TableRow, Typography } from '@mui/material'

/**
 * Shared table body rows for loading and empty states.
 * Both span the full width of the table via `colSpan`.
 */

/** Full-width row with a centered spinner (shown while data loads). */
export function LoadingRow ({ colSpan = 1 }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} align='center' sx={{ py: 4 }}>
        <CircularProgress />
      </TableCell>
    </TableRow>
  )
}

/** Full-width row with centered secondary text (shown when no rows match). */
export function EmptyRow ({ colSpan = 1, text = 'No records found' }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} align='center' sx={{ py: 4 }}>
        <Typography color='text.secondary'>{text}</Typography>
      </TableCell>
    </TableRow>
  )
}
