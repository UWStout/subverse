import { useState, useEffect } from 'react'
import {
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
import { createProject, updateProject, fetchOfferings, fetchClasses } from '../services/api'

/** Slug format enforced by the server (URL / file path safe). */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SLUG_HINT = 'Lowercase letters and numbers separated by single hyphens (e.g. final-project)'

/**
 * Reusable project form wrapped in a Dialog (mirrors OfferingForm).
 * Offering options are loaded from the API when the dialog opens; class
 * labels for the options come from the class list.
 *
 * Props
 * -----
 * open     – boolean controlling visibility
 * project  – existing project object (edit mode) or null (create mode)
 * onClose  – () => void  called when the dialog closes
 * onSubmit – () => void  callback fired after successful create / update
 */
export default function ProjectForm ({ open, project, onClose, onSubmit }) {
  const isEdit = !!project

  // Local form state (the offering select value is kept as a string)
  const [offeringId, setOfferingId] = useState('')
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [subversionUrl, setSubversionUrl] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [description, setDescription] = useState('')

  // Option lists loaded from the API
  const [offerings, setOfferings] = useState([])
  const [classes, setClasses] = useState([])
  const [optionsLoading, setOptionsLoading] = useState(false)

  // UI state
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)

  /* ---- Populate / reset fields when switching between create / edit ---- */

  useEffect(() => {
    if (!open) return
    let cancelled = false

    // Text fields can be prefilled immediately; the offering select is filled
    // once its option list has loaded (avoids out-of-range values).
    if (project) {
      setTitle(project.title || '')
      setSlug(project.slug || '')
      setSubversionUrl(project.subversion_url || '')
      setGitUrl(project.git_url || '')
      setDescription(project.description || '')
    } else {
      setTitle('')
      setSlug('')
      setSubversionUrl('')
      setGitUrl('')
      setDescription('')
    }
    setOfferingId('')
    setErrors({})
    setServerError('')

    async function init () {
      setOptionsLoading(true)
      try {
        const [offeringResp, classResp] = await Promise.all([
          fetchOfferings('*', '*', '*', 1, 100),
          fetchClasses(1, 100)
        ])
        if (cancelled) return
        setOfferings(offeringResp.data || [])
        setClasses(classResp.data || [])
        setOfferingId(project ? String(project.offering_id) : '')
      } catch (err) {
        if (!cancelled) setServerError(err.message)
      } finally {
        if (!cancelled) setOptionsLoading(false)
      }
    }

    init()

    return () => { cancelled = true }
  }, [project, open])

  /* ---- Validation ---- */

  function validate () {
    const errs = {}
    if (!offeringId) errs.offeringId = 'Offering is required'
    if (!title.trim()) errs.title = 'Title is required'
    if (!slug.trim()) {
      errs.slug = 'Slug is required'
    } else if (!SLUG_PATTERN.test(slug)) {
      errs.slug = `Invalid slug - ${SLUG_HINT}`
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  /* ---- Submit handler ---- */

  async function handleSubmit () {
    if (!validate()) return
    setLoading(true)
    setServerError('')

    // Empty optional fields are sent as null so they clear on update.
    const payload = {
      offeringId: Number(offeringId),
      title: title.trim(),
      slug: slug.trim(),
      subversionUrl: subversionUrl.trim() || null,
      gitUrl: gitUrl.trim() || null,
      description: description.trim() || null
    }

    try {
      if (isEdit) {
        await updateProject(project.id, payload)
      } else {
        await createProject(payload)
      }

      onSubmit()
      onClose()
    } catch (err) {
      setServerError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const classById = new Map(classes.map(c => [c.id, c]))

  function offeringLabel (o) {
    const cls = classById.get(o.class_id)
    const classPart = cls ? `${cls.subject} ${cls.number}` : `class ${o.class_id}`
    return `${classPart} – ${o.term} ${o.section}`
  }

  return (
    <Dialog open={open} onClose={!loading ? onClose : undefined} maxWidth='sm' fullWidth>
      <DialogTitle>{isEdit ? 'Edit Project' : 'Create Project'}</DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {optionsLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={20} />
              <span>Loading offerings…</span>
            </Box>
          )}

          <FormControl fullWidth error={!!errors.offeringId}>
            <InputLabel id='project-offering-label'>Offering</InputLabel>
            <Select
              labelId='project-offering-label'
              label='Offering'
              value={offeringId}
              onChange={e => setOfferingId(e.target.value)}
              disabled={loading || optionsLoading}
            >
              {offerings.map(o => (
                <MenuItem key={o.id} value={String(o.id)}>
                  {offeringLabel(o)}
                </MenuItem>
              ))}
            </Select>
            {errors.offeringId && (
              <Typography variant='caption' color='error' sx={{ mt: 0.5, ml: 1 }}>
                {errors.offeringId}
              </Typography>
            )}
          </FormControl>

          <TextField
            label='Title'
            value={title}
            onChange={e => setTitle(e.target.value)}
            error={!!errors.title}
            helperText={errors.title}
            fullWidth
            disabled={loading}
          />

          <TextField
            label='Slug'
            value={slug}
            onChange={e => setSlug(e.target.value)}
            error={!!errors.slug}
            helperText={errors.slug || SLUG_HINT}
            fullWidth
            disabled={loading}
          />

          <TextField
            label='Git URL'
            value={gitUrl}
            onChange={e => setGitUrl(e.target.value)}
            fullWidth
            disabled={loading}
          />

          <TextField
            label='Subversion URL'
            value={subversionUrl}
            onChange={e => setSubversionUrl(e.target.value)}
            fullWidth
            disabled={loading}
          />

          <TextField
            label='Description'
            value={description}
            onChange={e => setDescription(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            disabled={loading}
          />

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
