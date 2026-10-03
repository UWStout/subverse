import { Box, Button, Typography } from '@mui/material'

/**
 * Reusable page header: a large title on the left and an optional
 * primary action button on the right.
 *
 * Props
 * -----
 * title       – string, the page heading
 * actionLabel – string (optional), label for the action button
 * onAction    – () => void (optional), action button click handler
 * actionIcon  – React node (optional), icon shown before the action label
 */
export default function PageHeader ({ title, actionLabel, onAction, actionIcon }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
      <Typography variant='h4'>{title}</Typography>
      {actionLabel && (
        <Button variant='contained' startIcon={actionIcon} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Box>
  )
}
