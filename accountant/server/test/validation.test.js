import { describe, it, expect } from 'vitest'
import {
  validateField,
  validateClassSubject,
  validateClassNumber,
  validateTerm,
  validateSection,
  validationRules
} from '../../shared/validate.js'

// ---------------------------------------------------------------------------
// Unit tests for the shared field validators. The patterns under test live in
// config/validation-rules.js - if that file is customized for another
// university, these tests should be updated to match the new rules.
// ---------------------------------------------------------------------------

describe('shared validation rules', () => {
  describe('classSubject (e.g. CS, GDD, CYBER)', () => {
    it.each(['CS', 'GDD', 'PHYS', 'PHIL', 'CYBER', 'A', 'COMPSYS'])('accepts %s', (value) => {
      expect(validateClassSubject(value)).toBeNull()
    })

    it.each([
      ['cs', 'lowercase'],
      ['cS', 'mixed case'],
      ['C S', 'internal space'],
      ['CS1', 'digit'],
      ['C++', 'special characters'],
      ['CSÉ', 'accented letter']
    ])('rejects %s (%s)', (value) => {
      const err = validateClassSubject(value)
      expect(err).not.toBeNull()
      expect(err).toContain('subject')
    })
  })

  describe('classNumber (e.g. 101, 042, 101HON)', () => {
    it.each(['101', '042', '007', '999', '101HON', '000'])('accepts %s', (value) => {
      expect(validateClassNumber(value)).toBeNull()
    })

    it.each([
      ['11', 'too short'],
      ['1011', 'too long'],
      ['10a', 'lowercase suffix'],
      [' 101', 'leading space'],
      ['101 HON', 'space before suffix']
    ])('rejects %s (%s)', (value) => {
      const err = validateClassNumber(value)
      expect(err).not.toBeNull()
      expect(err).toContain('class number')
    })

    it('keeps leading zeros meaningful (042 is not 42)', () => {
      expect(validateClassNumber('042')).toBeNull()
      expect(validateClassNumber('42')).not.toBeNull()
    })
  })

  describe('offeringTerm (e.g. FALL25, WINTER26)', () => {
    it.each(['FALL25', 'WINTER26', 'SPRING27', 'SUMMER28', 'WI25', 'SP26', 'SU27', 'FA28'])('accepts %s', (value) => {
      expect(validateTerm(value)).toBeNull()
    })

    it.each([
      ['FALL2025', 'four-digit year'],
      ['fall25', 'lowercase semester'],
      ['AUTUMN26', 'unknown semester'],
      ['SPR25', 'partial code'],
      ['FALL 25', 'space between parts'],
      ['FALL2', 'one-digit year'],
      ['WINTER25A', 'trailing letter']
    ])('rejects %s (%s)', (value) => {
      const err = validateTerm(value)
      expect(err).not.toBeNull()
      expect(err).toContain('term')
    })
  })

  describe('offeringSection (e.g. 101, 101C, DH4)', () => {
    it.each(['101', '042', '007', '101C', 'DH4', 'DH7', 'D4'])('accepts %s', (value) => {
      expect(validateSection(value)).toBeNull()
    })

    it.each([
      ['A', 'bare letter'],
      ['B', 'bare letter'],
      ['10', 'two digits'],
      ['1011', 'four digits'],
      ['dh4', 'lowercase prefix'],
      ['DH44', 'prefix with two digits'],
      ['1a', 'lowercase suffix'],
      ['10 1', 'internal space']
    ])('rejects %s (%s)', (value) => {
      const err = validateSection(value)
      expect(err).not.toBeNull()
      expect(err).toContain('section')
    })
  })

  describe('validateField (generic access)', () => {
    it('validates any rule by its config key', () => {
      expect(validateField('classSubject', 'PHYS')).toBeNull()
      expect(validateField('offeringTerm', 'AUTUMN26')).not.toBeNull()
    })

    it('throws for an unknown rule name', () => {
      expect(() => validateField('bogus', 'x')).toThrow(/Unknown validation rule/)
    })

    it('includes the description and examples in error messages', () => {
      const err = validateTerm('FALL2025')
      expect(err).toContain(validationRules.offeringTerm.description)
      expect(err).toContain(validationRules.offeringTerm.examples[0])
    })
  })
})
