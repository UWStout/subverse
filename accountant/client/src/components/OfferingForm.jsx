import { useState, useEffect } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { createOffering, updateOffering, fetchClasses, fetchTeachers, createClass } from '../services/api'

/** Sentinel value for the "create a new class" option in the class select. */
const NEW_CLASS_VALUE = '__new_class__'

/**
 * Reusable offering form wrapped in a Dialog (mirrors UserForm).
 * Class and teacher options are loaded from the API when the dialog opens.
 *
 * Props
 * -----
 * open       – boolean controlling visibility
 * offering   – existing offering object (edit mode) or null (create mode)
 * onClose    – () => void  called when the dialog closes
 * onSubmit   – () => void  callback fired after successful create / update
 */
export default function OfferingForm ({ open, offering, onClose, onSubmit }) {
  const isEdit = !!offering

  // Local form state (select values are kept as strings to match option values)
  const [classId, setClassId] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [term, setTerm] = useState('')
  const [section, setSection] = useState('')

  // Option lists loaded from the API
  const [classes, setClasses] = useState([])
  const [teachers, setTeachers] = useState([])
  const [optionsLoading, setOptionsLoading] = useState(false)

  // Inline new-class fields (only used when "New Class" is selected)
  const [newClassSubject, setNewClassSubject] = useState('')
  const [newClassNumber, setNewClassNumber] = useState('')
  const [newClassTitle, setNewClassTitle] = useState('')

  // UI state
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)

  /* ---- Populate / reset fields when switching between create / edit ---- */

  useEffect(() => {
    if (!open) return
    let cancelled = false

    // Term / section can be prefilled immediately; the selects are filled
    // once their option lists have loaded (avoids out-of-range values).
    if (offering) {
      setTerm(offering.term || '')
      setSection(offering.section || '')
    } else {
      setClassId('')
      setTeacherId('')
      setTerm('')
      setSection('')
    }
    // The inline new-class fields always start empty on open
    setNewClassSubject('')
    setNewClassNumber('')
    setNewClassTitle('')
    setErrors({})
    setServerError('')

    async function init () {
      setOptionsLoading(true)
      try {
        const [classResp, teacherResp] = await Promise.all([fetchClasses(), fetchTeachers()])
        if (cancelled) return
        setClasses(classResp.data || [])
        setTeachers(teacherResp.data || [])
        setClassId(offering ? String(offering.class_id) : '')
        setTeacherId(offering ? String(offering.teacher_id) : '')
      } catch (err) {
        if (!cancelled) setServerError(err.message)
      } finally {
        if (!cancelled) setOptionsLoading(false)
      }
    }

    init()

    return () => { cancelled = true }
  }, [offering, open])

  /* ---- Validation ---- */

  function validate () {
    const errs = {}
    if (!classId) {
      errs.classId = 'Class is required'
    } else if (classId === NEW_CLASS_VALUE) {
      // "New Class" selected - the inline fields must be filled in
      if (!newClassSubject.trim()) errs.newClassSubject = 'Subject is required'
      if (!newClassNumber.trim()) errs.newClassNumber = 'Number is required'
      if (!newClassTitle.trim()) errs.newClassTitle = 'Title is required'
    }
    if (!teacherId) errs.teacherId = 'Teacher is required'
    if (!term.trim()) errs.term = 'Term is required'
    if (!section.trim()) errs.section = 'Section is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  /* ---- Submit handler ---- */

  async function handleSubmit () {
    if (!validate()) return
    setLoading(true)
    setServerError('')

    try {
      // Resolve the class id  when "New Class" is selected, create the
      // class first and use the id of the record that comes back.
      let finalClassId = Number(classId)
      if (classId === NEW_CLASS_VALUE) {
        const newClass = await createClass({
          subject: newClassSubject.trim(),
          number: newClassNumber.trim(),
          title: newClassTitle.trim()
        })
        finalClassId = newClass.id
      }

      const payload = {
        classId: finalClassId,
        teacherId: Number(teacherId),
        term: term.trim(),
        section: section.trim()
      }

      if (isEdit) {
        await updateOffering(offering.id, payload)
      } else {
        await createOffering(payload)
      }

      onSubmit()
      onClose()
    } catch (err) {
      setServerError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onClose={!loading ? onClose : undefined} maxWidth='sm' fullWidth>
      <DialogTitle>{isEdit ? 'Edit Offering' : 'Create Offering'}</DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {optionsLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={20} />
              <span>Loading classes and teachers…</span>
            </Box>
          )}

          <FormControl fullWidth error={!!errors.classId}>
            <InputLabel id='offering-class-label'>Class</InputLabel>
            <Select
              labelId='offering-class-label'
              label='Class'
              value={classId}
              onChange={e => setClassId(e.target.value)}
              disabled={loading || optionsLoading}
            >
              {classes.map(c => (
                <MenuItem key={c.id} value={String(c.id)}>
                  {`${c.subject} ${c.number} – ${c.title}`}
                </MenuItem>
              ))}
              <MenuItem value={NEW_CLASS_VALUE}>New Class</MenuItem>
            </Select>
            {errors.classId && (
              <Typography variant='caption' color='error' sx={{ mt: 0.5, ml: 1 }}>
                {errors.classId}
              </Typography>
            )}
          </FormControl>

          {/* Extra fields for a brand-new class - only visible while
              "New Class" is the selected option */}
          {classId === NEW_CLASS_VALUE && (
            <Accordion variant='outlined' defaultExpanded disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>New Class Details</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pb: 1 }}>
                  <TextField
                    label='Subject'
                    value={newClassSubject}
                    onChange={e => setNewClassSubject(e.target.value)}
                    error={!!errors.newClassSubject}
                    helperText={errors.newClassSubject}
                    fullWidth
                    disabled={loading}
                  />

                  <TextField
                    label='Number'
                    value={newClassNumber}
                    onChange={e => setNewClassNumber(e.target.value)}
                    error={!!errors.newClassNumber}
                    helperText={errors.newClassNumber}
                    fullWidth
                    disabled={loading}
                  />

                  <TextField
                    label='Title'
                    value={newClassTitle}
                    onChange={e => setNewClassTitle(e.target.value)}
                    error={!!errors.newClassTitle}
                    helperText={errors.newClassTitle}
                    fullWidth
                    disabled={loading}
                  />
                </Box>
              </AccordionDetails>
            </Accordion>
          )}

          <FormControl fullWidth error={!!errors.teacherId}>
            <InputLabel id='offering-teacher-label'>Teacher</InputLabel>
            <Select
              labelId='offering-teacher-label'
              label='Teacher'
              value={teacherId}
              onChange={e => setTeacherId(e.target.value)}
              disabled={loading || optionsLoading}
            >
              {teachers.map(t => (
                <MenuItem key={t.id} value={String(t.id)}>
                  {t.username}
                </MenuItem>
              ))}
            </Select>
            {errors.teacherId && (
              <Typography variant='caption' color='error' sx={{ mt: 0.5, ml: 1 }}>
                {errors.teacherId}
              </Typography>
            )}
          </FormControl>

          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label='Term'
              value={term}
              onChange={e => setTerm(e.target.value)}
              error={!!errors.term}
              helperText={errors.term}
              fullWidth
              disabled={loading}
            />

            <TextField
              label='Section'
              value={section}
              onChange={e => setSection(e.target.value)}
              error={!!errors.section}
              helperText={errors.section}
              fullWidth
              disabled={loading}
            />
          </Box>

          {serverError && (
            <Alert severity='error' sx={{ mt: 1 }}>{serverError}</Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant='contained' onClick={handleSubmit} disabled={loading || optionsLoading}>
          {isEdit ? 'Save Changes' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
