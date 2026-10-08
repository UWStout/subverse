/* eslint-disable camelcase */
/**
 * Parsing logic for bulk user creation (issue #3).
 *
 * The operator pastes a roster of "Name <email>" entries, e.g.:
 *
 *   Doe, John <jdoe@my.university.edu>; Smith, Jane <jsmith@my.university.edu>
 *   John Doe <jdoe@my.university.edu>
 *   Jane Smith <jsmith@my.university.edu>
 *
 * Rules:
 *  - A comma inside the name means reversed order ("Last, First"); no comma
 *    means normal order ("First Last"). The username is derived from the
 *    local part of the email address (before the @).
 *  - Entries are separated by newlines, semicolons, or commas. The separator
 *    is auto-detected with priority newline > semicolon > comma (a reversed
 *    name such as "Doe, John" always contains a comma, so commas are only
 *    assumed when nothing else is present).
 *  - Because a reversed name contains its own comma, comma-separated input is
 *    split around the bracketed <email> addresses rather than on every comma.
 */

/** Matches one bracketed <email> span (the /g flag lets us find all of them). */
const EMAIL_SPAN_RE = /<([^<>]+)>/g

/** Same shape as the client-side check in UserForm: local@domain.tld, no spaces. */
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/**
 * A plausible name part: starts with a letter (any script), followed by
 * letters, apostrophes, hyphens, periods and spaces. Rejects labels such as
 * "Roster:" or stray digits that would otherwise be absorbed into a name.
 */
const NAME_PART_RE = /^[\p{L}][\p{L}'\- .]*$/u

/**
 * Auto-detect the separator used in a pasted roster.
 * Newlines win over semicolons, which win over commas.
 */
export function detectSeparator (text) {
  if (/[\r\n]/.test(text)) return 'newline'
  if (text.includes(';')) return 'semicolon'
  return 'comma'
}

/**
 * Split comma-separated text into entry chunks around the <email> spans so
 * that the comma inside "Last, First" does not break an entry in two.
 * Text before the first span is absorbed into the first chunk's name region
 * (and rejected by name validation when it is garbage); text after the last
 * span becomes its own chunk and fails with "Missing <email> address".
 */
function sliceCommaEntries (text) {
  const spans = [...text.matchAll(EMAIL_SPAN_RE)]
  if (spans.length === 0) return [text] // no addresses at all - one bad chunk

  const chunks = []
  let start = 0
  for (const span of spans) {
    chunks.push(text.slice(start, span.index + span[0].length))
    // Advance past the separator (and whitespace) that follows this entry so
    // it does not become part of the next entry's name.
    let next = span.index + span[0].length
    while (next < text.length && /[\s,]/.test(text.charAt(next))) next++
    start = next
  }
  const trailing = text.slice(start)
  if (trailing.trim()) chunks.push(trailing)
  return chunks
}

/**
 * Parse one trimmed entry chunk. Returns { first_name, last_name, email,
 * username } on success or { error } when the chunk is malformed.
 */
function parseChunk (trimmed) {
  const spanCount = (trimmed.match(EMAIL_SPAN_RE) || []).length
  if (spanCount === 0) return { error: 'Missing <email> address' }
  if (spanCount > 1) return { error: 'Multiple <email> addresses in one entry' }

  const m = /^([^<]*?)\s*<([^<>]+)>$/.exec(trimmed)
  if (!m) return { error: 'Malformed entry, expected "Name <email>"' }

  const name = m[1].trim()
  const email = m[2].trim()

  if (!name) return { error: 'Missing name before the <email> address' }
  if (!EMAIL_RE.test(email)) return { error: `Invalid email address '${email}'` }

  let first_name
  let last_name
  const commaIdx = name.indexOf(',')
  if (commaIdx >= 0) {
    // Reversed order: "Last, First"
    last_name = name.slice(0, commaIdx).trim()
    first_name = name.slice(commaIdx + 1).trim()
    if (!NAME_PART_RE.test(last_name) || !NAME_PART_RE.test(first_name)) {
      return { error: `Malformed name '${name}', expected "Last, First"` }
    }
  } else {
    // Normal order: "First Last ..." (a single word goes to the first name)
    if (!NAME_PART_RE.test(name)) {
      return { error: `Malformed name '${name}', expected "First Last" or "Last, First"` }
    }
    const tokens = name.split(/\s+/)
    first_name = tokens[0]
    last_name = tokens.length > 1 ? tokens.slice(1).join(' ') : null
  }

  return { first_name, last_name, email, username: email.split('@')[0] }
}

/**
 * Parse a pasted roster into structured entries.
 *
 * Returns { entries, errors }:
 *   entries – [{ index, raw, first_name, last_name, email, username }]
 *             (index is the 1-based position of the segment in the input)
 *   errors  – [{ index, raw, reason }] for segments that could not be parsed
 */
export function parseBulkEntries (text) {
  const entries = []
  const errors = []
  const source = String(text ?? '')

  if (!source.trim()) return { entries, errors }

  const separator = detectSeparator(source)

  let chunks
  if (separator === 'comma') {
    chunks = sliceCommaEntries(source)
  } else if (separator === 'semicolon') {
    chunks = source.split(';')
  } else {
    // Split on a single newline (not [\r\n]+) so blank lines still occupy an
    // index - reported entry numbers then match the pasted line numbers.
    chunks = source.split(/[\r\n]/)
  }

  chunks.forEach((raw, i) => {
    const index = i + 1
    const trimmed = raw.trim()
    if (!trimmed) return // blank lines / segments are skipped silently
    const parsed = parseChunk(trimmed)
    if (parsed.error) {
      errors.push({ index, raw: trimmed, reason: parsed.error })
    } else {
      entries.push({
        index,
        raw: trimmed,
        first_name: parsed.first_name,
        last_name: parsed.last_name,
        email: parsed.email,
        username: parsed.username
      })
    }
  })

  return { entries, errors }
}
