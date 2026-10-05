// ---------------------------------------------------------------------------
// Field validators for class and offering data.
//
// The actual patterns live in config/validation-rules.js so they can be
// customized per university without touching code. This module compiles the
// patterns once and exposes small helpers shared by the API routes
// (server/routes/class.js, server/routes/offering.js) and the React forms
// (client/src/components/OfferingForm.jsx).
// ---------------------------------------------------------------------------

import { validationRules } from '../config/validation-rules.js'

/** Compiled regex cache keyed by rule name. */
const compiledPatterns = new Map()

function getPattern (key) {
  if (!compiledPatterns.has(key)) {
    const rule = validationRules[key]
    if (!rule || typeof rule.pattern !== 'string') {
      throw new Error(`No validation rule defined for "${key}" in config/validation-rules.js`)
    }
    compiledPatterns.set(key, new RegExp(rule.pattern))
  }
  return compiledPatterns.get(key)
}

/**
 * Validate a value against a named rule from config/validation-rules.js.
 *
 * Callers should check for presence (required fields) before calling this;
 * an empty or non-string value is simply reported as invalid here.
 *
 * @param {string} key   - rule name (classSubject, classNumber, offeringTerm, offeringSection)
 * @param {string} value - the value to check
 * @returns {string|null} null when the value is valid, otherwise an error
 *                        message describing what went wrong.
 */
export function validateField (key, value) {
  const rule = validationRules[key]
  if (!rule) throw new Error(`Unknown validation rule "${key}"`)
  if (typeof value !== 'string' || !getPattern(key).test(value)) {
    return `Invalid ${rule.label} "${String(value)}": expected ${rule.description} (e.g. ${rule.examples.join(', ')})`
  }
  return null
}

/** Validate a class subject code (e.g. CS, GDD, CYBER). */
export function validateClassSubject (value) {
  return validateField('classSubject', value)
}

/** Validate a class number (e.g. 101, 042, 101HON). */
export function validateClassNumber (value) {
  return validateField('classNumber', value)
}

/** Validate an offering term (e.g. FALL25, WINTER26). */
export function validateTerm (value) {
  return validateField('offeringTerm', value)
}

/** Validate an offering section (e.g. 101, 101C, DH4). */
export function validateSection (value) {
  return validateField('offeringSection', value)
}

export { validationRules }
