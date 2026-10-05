// ---------------------------------------------------------------------------
// University validation rules for class and offering fields.
//
// This file is the single place where your institution's field patterns are
// defined. Both the API (server/routes/class.js, server/routes/offering.js)
// and the React forms (client/src/components/OfferingForm.jsx) validate
// against these rules through shared/validate.js, so editing a pattern here
// changes behavior everywhere - no code changes needed.
//
// To adapt these rules to a different university, edit the `pattern` strings
// below (and their descriptions / examples). Each rule is an object with:
//
//   label       - field name used in error messages
//   pattern     - a regular expression (as a string). A value is valid only
//                 if it matches the ENTIRE pattern; the ^...$ anchors are
//                 part of the pattern.
//   description - short human-readable explanation of what is allowed;
//                 included in error messages.
//   examples    - valid sample values; included in error messages and useful
//                 when customizing the rules for another university.
// ---------------------------------------------------------------------------

export const validationRules = {
  /**
   * Class subject code - e.g. CS, GDD, PHYS, PHIL, CYBER.
   * One or more capital Latin letters (A-Z). No digits, spaces, hyphens or
   * accented characters. The length varies by subject.
   */
  classSubject: {
    label: 'subject',
    pattern: '^[A-Z]+$',
    description: 'one or more capital letters (A-Z) with no spaces, digits or accents',
    examples: ['CS', 'GDD', 'PHYS', 'PHIL', 'CYBER']
  },

  /**
   * Class number - e.g. 101, 042, 101HON.
   * Exactly three digits (leading zeros are significant and must be kept),
   * optionally followed by capital letters (e.g. HON for honors sections).
   */
  classNumber: {
    label: 'class number',
    pattern: '^\\d{3}[A-Z]*$',
    description: 'exactly three digits (leading zeros are significant) with optional capital letters appended',
    examples: ['101', '042', '101HON']
  },

  /**
   * Offering term - e.g. FALL25, WINTER26, FA27.
   * A semester name (WINTER, SPRING, SUMMER or FALL) or its two-letter code
   * (WI, SP, SU or FA), immediately followed by a two-digit year. To change
   * the semester names / codes, edit the alternatives in the pattern; to
   * change the year length, edit \d{2}.
   */
  offeringTerm: {
    label: 'term',
    pattern: '^(?:WINTER|SPRING|SUMMER|FALL|WI|SP|SU|FA)\\d{2}$',
    description: 'a semester name (WINTER, SPRING, SUMMER or FALL) or two-letter code (WI, SP, SU or FA), immediately followed by a two-digit year',
    examples: ['FALL25', 'WINTER26', 'SPRING27', 'FA28']
  },

  /**
   * Offering section - e.g. 101, 042C, DH4.
   * Either:
   *   - a three-digit number (leading zeros significant) with optional
   *     capital letters appended (101, 042, 101C), or
   *   - one to three capital letters followed by a single digit (DH4, DH7).
   * Tighten [A-Z]{1,3} to [A-Z]{2} if only two-letter prefixes are used.
   */
  offeringSection: {
    label: 'section',
    pattern: '^(?:\\d{3}[A-Z]*|[A-Z]{1,3}\\d)$',
    description: 'three digits with optional capital letters appended (e.g. 101, 101C), or a capital-letter prefix and one digit (e.g. DH4)',
    examples: ['101', '042', '101C', 'DH4', 'DH7']
  }
}

export default validationRules
