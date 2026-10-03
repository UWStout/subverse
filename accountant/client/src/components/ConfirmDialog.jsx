import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'

/**
 * Reusable confirmation dialog (used for destructive actions such as delete).
 *
 * Props
 * -----
 * open         – boolean controlling visibility
 * title        – string, dialog heading
 * message      – React node shown in the body
 * confirmLabel – string (optional), label of the confirm button
 * onConfirm    – () => void, fired when the confirm button is clicked
 * onClose      – () => void, fired when the dialog is dismissed
 */
export default function ConfirmDialog ({ open, title = 'Are you sure?', message, confirmLabel = 'Delete', onConfirm, onClose }) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onConfirm} color='error' variant='contained'>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  )
}
