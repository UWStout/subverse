import 'dotenv/config'
import { createHash } from 'crypto'
import { execCommand } from './docker.js'
import { getDatabase } from './db.js'

const SVN_CONTAINER_NAME = process.env.SVN_CONTAINER_NAME ?? 'svn_gateway_ur'

// Paths inside the SVN container (see subversion/docker-compose.yaml and
// config/apache2-gateway/conf.d/dav_svn.conf - the same files are mounted
// into both the gateway and admin containers).
const SVN_ROOT = '/var/svn'
const PASSWD_FILE = '/etc/subversion/passwd'
const AUTHZ_FILE = '/etc/subversion/subversion-access-control'

// Repository names come from project slugs (lowercase alphanumerics with
// single hyphens). They are embedded in shell strings and file paths below,
// so anything outside this shape is rejected outright.
const REPO_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// Usernames that are safe to place inside an SVN authz group list (no commas,
// spaces or other characters that would break the file's syntax).
const AUTHZ_SAFE_USERNAME = /^[A-Za-z0-9._-]+$/

/**
 * Default property profiles keyed by project type. The Project model does not
 * carry a type field yet, so everything resolves to 'default' for now - adding
 * a new profile only requires extending this map (and passing the type through
 * from the caller).
 *
 *   ignore    svn:ignore patterns set on the repository root at creation time.
 *   needsLock file extensions that should carry svn:needs-lock so editors are
 *             forced to lock them before modifying (binaries, media, ...).
 */
const PROP_PROFILES = {
  default: {
    ignore: [
      '.git',
      '.hg',
      '.DS_Store',
      'Thumbs.db',
      'desktop.ini',
      '*.tmp',
      '*~',
      '.*.sw?',
      '.#*',
      '.idea/',
      '.vscode/',
      '__pycache__/',
      '.venv/'
    ],
    needsLock: [
      '*.blend',
      '*.psd',
      '*.ai',
      '*.sketch',
      '*.fbx',
      '*.wav',
      '*.mp3',
      '*.mp4',
      '*.zip',
      '*.7z',
      '*.rar'
    ]
  }
}

/**
 * Run an SVN sync operation best-effort: failures are logged but never thrown.
 * The database is the source of truth, so a flaky container must not block
 * account or project management (a later retry or re-sync heals the drift).
 */
export async function bestEffortSvn (label, fn) {
  try {
    await fn()
  } catch (err) {
    console.error(`SVN sync failed (${label}):`, err)
  }
}

// ---------------------------------------------------------------------------
// Low-level container helpers
// ---------------------------------------------------------------------------

/**
 * Run a command in the SVN container and throw when it exits non-zero.
 * Wraps execCommand so callers get plain promises with meaningful errors.
 */
async function runInContainer (command) {
  const result = await execCommand(SVN_CONTAINER_NAME, command)
  if (result.exitCode !== 0) {
    const detail = result.error || result.output
    throw new Error(`Command '${command.join(' ')}' failed in container ${SVN_CONTAINER_NAME} (exit ${result.exitCode}): ${detail}`.trim())
  }
  return result
}

/**
 * Read a file from the SVN container.
 *
 * @param {string} filePath
 * @param {Object} [options]
 * @param {boolean} [options.allowMissing] Resolve to '' when the file does not exist yet.
 * @returns {Promise<string>}
 */
async function readContainerFile (filePath, { allowMissing = false } = {}) {
  const result = await execCommand(SVN_CONTAINER_NAME, ['cat', filePath])
  if (result.exitCode !== 0) {
    if (allowMissing && /no such file/i.test(result.error)) return ''
    throw new Error(`Failed to read ${filePath} in container ${SVN_CONTAINER_NAME}: ${result.error || result.output}`.trim())
  }
  return result.output
}

/**
 * Write a file into the SVN container. The content is fed through stdin so it
 * never has to be quoted or escaped inside a shell command line.
 *
 * @param {string} filePath
 * @param {string} content
 */
async function writeContainerFile (filePath, content) {
  const result = await execCommand(SVN_CONTAINER_NAME, ['sh', '-c', `cat > ${filePath}`], content)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to write ${filePath} in container ${SVN_CONTAINER_NAME}: ${result.error || result.output}`.trim())
  }
}

// ---------------------------------------------------------------------------
// Config file building (pure - exported for testing)
// ---------------------------------------------------------------------------

/**
 * Hash a plaintext password in the {SHA} format (the same one `htpasswd -d`
 * produces), which mod_authn_file in the gateway verifies natively. The
 * Accountant keeps bcrypt hashes in its own database; this one-way SHA value
 * is only ever derived from a plaintext password at the moment it is known
 * (create / update / reset).
 */
export function sha1Hash (password) {
  return `{SHA}${createHash('sha1').update(password).digest('base64')}`
}

/**
 * Build a full htpasswd-style line for the SVN passwd file.
 */
export function passwdLine (username, password) {
  return `${username}:${sha1Hash(password)}`
}

/**
 * Insert or replace the entry for `username` in a passwd file's content.
 * All other lines are preserved verbatim.
 */
export function upsertPasswdLine (content, username, hash) {
  const lines = String(content ?? '').split('\n').filter(line => line.trim() !== '')
  const next = []
  let replaced = false
  for (const line of lines) {
    const sep = line.indexOf(':')
    if (sep > 0 && line.slice(0, sep) === username) {
      if (!replaced) {
        next.push(`${username}:${hash}`)
        replaced = true
      }
      continue
    }
    next.push(line)
  }
  if (!replaced) next.push(`${username}:${hash}`)
  return next.join('\n') + '\n'
}

/**
 * Remove the entry for `username` from a passwd file's content.
 * Returns { content, removed }.
 */
export function removePasswdLine (content, username) {
  const lines = String(content ?? '').split('\n').filter(line => line.trim() !== '')
  const next = []
  let removed = false
  for (const line of lines) {
    const sep = line.indexOf(':')
    if (sep > 0 && line.slice(0, sep) === username) {
      removed = true
      continue
    }
    next.push(line)
  }
  return { content: next.join('\n') + (next.length > 0 ? '\n' : ''), removed }
}

/**
 * List the usernames present in a passwd file's content.
 */
export function parsePasswdUsernames (content) {
  return String(content ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
    .map(line => line.slice(0, line.indexOf(':')))
    .filter(username => username !== undefined && username !== '')
}

/**
 * Build the full content of the SVN authz file (subversion-access-control).
 *
 * Layout:
 *   - an `admins` group containing every ADMIN-type user;
 *   - one [groups] entry per project: every assigned student plus the
 *     offering's teacher, named after the project slug;
 *   - a global `[/]` section granting the admins group full r/w on every
 *     repository. There is deliberately no blanket read default: only users
 *     explicitly granted access (admins or one of their project groups) can
 *     see anything;
 *   - one `[/<slug>]` section granting the project group full r/w on its repo.
 *
 * @param {Object[]} projects Rows shaped like the Prisma Project model with
 *   `assignments[].student.username` and `offering.teacher.username` populated.
 * @param {string[]} [adminUsernames] Usernames of all ADMIN-type users.
 * @returns {string}
 */
export function buildAccessControlFile (projects, adminUsernames = []) {
  const lines = [
    '# Generated by the Accountant service - do not edit manually.',
    '',
    '[groups]'
  ]

  const admins = [...new Set((adminUsernames ?? []).filter(name => name && AUTHZ_SAFE_USERNAME.test(name)))]
  if (admins.length > 0) lines.push(`admins = ${admins.join(', ')}`)

  const repoSections = []
  for (const project of projects ?? []) {
    if (!project?.slug || !REPO_NAME_PATTERN.test(project.slug)) continue

    const members = new Set()
    for (const assignment of project.assignments ?? []) {
      const username = assignment?.student?.username
      if (username && AUTHZ_SAFE_USERNAME.test(username)) members.add(username)
    }
    const teacher = project.offering?.teacher?.username
    if (teacher && AUTHZ_SAFE_USERNAME.test(teacher)) members.add(teacher)

    // No members -> no group; the repo is only reachable by admins until
    // someone is assigned.
    if (members.size === 0) continue

    lines.push(`${project.slug} = ${[...members].join(', ')}`)
    repoSections.push('', `[/${project.slug}]`, `@${project.slug} = rw`)
  }

  lines.push('', '[/]', '@admins = rw')
  return [...lines, ...repoSections].join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Write serialization
// ---------------------------------------------------------------------------

// The passwd and authz files are small shared state that several routes touch
// (create / reset / delete can arrive concurrently). A simple in-process lock
// keeps each read-modify-write cycle atomic within this service.
let writeLock = Promise.resolve()
function withWriteLock (fn) {
  const run = writeLock.then(fn, fn)
  // Never poison the chain: a failure must not block later writes.
  writeLock = run.catch(() => {})
  return run
}

// ---------------------------------------------------------------------------
// Repository lifecycle
// ---------------------------------------------------------------------------

/** Local file:// URL of a repository (used for svn operations in-container). */
function repoUrl (repoName) {
  return `file://${SVN_ROOT}/${repoName}`
}

/**
 * Creates a svn repo in the docker container
 *
 * @param {Object} projectInfo (should match the prisma project model)
 * @returns {Promise<void>}
 */
export async function createRepository (projectInfo) {
  // Get repo name
  const repoName = projectInfo?.slug
  if (!repoName || !REPO_NAME_PATTERN.test(repoName)) {
    throw new Error('Missing or invalid project slug')
  }

  // Create the bare repository. Tolerate a leftover from an interrupted run
  // so a retry can repair instead of failing on "already exists".
  try {
    await runInContainer(['svnadmin', 'create', `${SVN_ROOT}/${repoName}`])
  } catch (err) {
    if (!/already exists/i.test(err.message)) throw err
    console.warn(`[subversion] repository '${repoName}' already exists - continuing to repair it`)
  }

  // Apply the standard monorepo structure: trunk / branches / tags folders
  // committed as the very first revision. A throwaway directory is imported so
  // the whole layout lands in a single initial commit. Skipped when the repo
  // already has content (interrupted-run repair).
  const info = await execCommand(SVN_CONTAINER_NAME, ['svn', 'info', repoUrl(repoName)])
  if (info.exitCode !== 0) {
    const initDir = `/tmp/${repoName}-init`
    await runInContainer(['sh', '-c', [
      `rm -rf ${initDir}`,
      `mkdir -p ${initDir}/trunk ${initDir}/branches ${initDir}/tags`,
      `svn import ${initDir} ${repoUrl(repoName)} -m "Initial commit: standard monorepo structure (trunk, branches, tags)"`,
      `rm -rf ${initDir}`
    ].join(' && ')])
  }

  // Apply the default properties for the project type
  await applyDefaultProperties(repoName, projectInfo.type ?? 'default')

  // Everything above ran as root; hand the whole repository back to apache so
  // the WebDAV service can read and commit inside it.
  await runInContainer(['chown', '-R', 'apache:apache', `${SVN_ROOT}/${repoName}`])
}

/**
 * Apply the default svn-props for a project type to a freshly created repo.
 *
 *   - svn:ignore on the repository root (set through the file:// URL, which
 *     writes straight into the repository without a commit step).
 *   - svn:needs-lock: Subversion has no repository-wide default for this
 *     property - it must be set on each individual file. The repo is still
 *     empty at creation time, so there is nothing to tag yet; the profile's
 *     `needsLock` extensions document what should be tagged, and
 *     tagNeedsLock() applies it whenever content lands (e.g. a teacher import).
 */
async function applyDefaultProperties (repoName, projectType) {
  const profile = PROP_PROFILES[projectType] ?? PROP_PROFILES.default

  await runInContainer([
    'svn', 'propset', 'svn:ignore', profile.ignore.join('\n'), repoUrl(repoName)
  ])
}

/**
 * Tag existing paths in a repository with svn:needs-lock (files must be locked
 * before they can be modified). Use this when content is added to a repo, for
 * example after a teacher imports starter files - tag the binary/media
 * extensions listed in PROP_PROFILES.
 *
 * @param {string} repoName
 * @param {string[]} relativePaths Paths relative to the repository root.
 */
export async function tagNeedsLock (repoName, relativePaths) {
  if (!repoName || !REPO_NAME_PATTERN.test(repoName)) {
    throw new Error('Missing or invalid repository name')
  }
  for (const relativePath of relativePaths ?? []) {
    const clean = String(relativePath).replace(/^\/+/, '')
    if (!clean) continue
    await runInContainer(['svn', 'propset', 'svn:needs-lock', 'true', `${repoUrl(repoName)}/${clean}`])
  }
}

/**
 * Rename a repository in place, preserving all history and properties by
 * dumping the old repo into the new one.
 */
export async function renameRepository (oldSlug, newSlug) {
  if (!oldSlug || !REPO_NAME_PATTERN.test(oldSlug)) throw new Error('Missing or invalid current slug')
  if (!newSlug || !REPO_NAME_PATTERN.test(newSlug)) throw new Error('Missing or invalid new slug')
  if (oldSlug === newSlug) return

  await runInContainer(['svnadmin', 'create', `${SVN_ROOT}/${newSlug}`])
  // Migrate history + properties, then drop the old repository
  await runInContainer(['sh', '-c', `svnadmin dump ${SVN_ROOT}/${oldSlug} | svnadmin load ${SVN_ROOT}/${newSlug} && rm -rf ${SVN_ROOT}/${oldSlug}`])
  await runInContainer(['chown', '-R', 'apache:apache', `${SVN_ROOT}/${newSlug}`])
}

/**
 * Delete a repository from the container and rebuild the authz file so the
 * project's group no longer appears. (Call after the DB row is gone.)
 */
export async function deleteRepository (slug) {
  if (!slug || !REPO_NAME_PATTERN.test(slug)) throw new Error('Missing or invalid repository name')

  await runInContainer(['sh', '-c', `rm -rf ${SVN_ROOT}/${slug}`])
  await rebuildAccessControlFile()
}

// ---------------------------------------------------------------------------
// Access synchronization
// ---------------------------------------------------------------------------

/** Project rows with the relations the authz builder needs. */
const ACCESS_INCLUDE = {
  assignments: { include: { student: { select: { username: true } } } },
  offering: { include: { teacher: { select: { username: true } } } }
}

/**
 * Rebuild the SVN authz file from the full current database state. Running
 * against the whole DB (rather than patching one project's section) makes the
 * operation idempotent and automatically drops stale groups when students are
 * unassigned or projects disappear. Accepts pre-fetched rows to avoid
 * querying twice.
 */
async function rebuildAccessControlFile (projects = null, adminUsernames = null) {
  const db = getDatabase()
  const [rows, admins] = await Promise.all([
    projects ?? db.project.findMany({ include: ACCESS_INCLUDE }),
    adminUsernames ?? (await db.user.findMany({ where: { type: 'ADMIN' }, select: { username: true } })).map(u => u.username)
  ])

  return withWriteLock(async () => {
    await writeContainerFile(AUTHZ_FILE, buildAccessControlFile(rows, admins))
  })
}

/**
 * Synchronizes the SVN access configuration with a project's current team.
 *
 * @param {Object} projectInfo (should match the prisma project model w/ a populated assignments array)
 * @returns {Promise<void>}
 */
export async function synchronizeRepositoryAccess (projectInfo) {
  const repoName = projectInfo?.slug
  if (!repoName || !REPO_NAME_PATTERN.test(repoName)) {
    throw new Error('Missing or invalid project slug')
  }

  // Rebuild the authz file from the full database state: a group per project
  // (assigned students + teacher) with r/w on its repo, plus the admins group
  // holding universal r/w.
  const db = getDatabase()
  const [projects, adminUsers] = await Promise.all([
    db.project.findMany({ include: ACCESS_INCLUDE }),
    db.user.findMany({ where: { type: 'ADMIN' }, select: { username: true } })
  ])
  await rebuildAccessControlFile(projects, adminUsers.map(u => u.username))

  // Make sure every member of THIS project can actually authenticate: each one
  // needs a line in the passwd file. We cannot derive those from the bcrypt
  // hashes stored here (one-way), so missing members are reported - they get
  // their entry automatically when they set or reset their password.
  const fresh = projects.find(p => p.slug === repoName) ?? projectInfo

  const members = new Set()
  for (const assignment of fresh.assignments ?? []) {
    if (assignment?.student?.username) members.add(assignment.student.username)
  }
  if (fresh.offering?.teacher?.username) members.add(fresh.offering.teacher.username)

  const passwdContent = await readContainerFile(PASSWD_FILE, { allowMissing: true })
  const known = new Set(parsePasswdUsernames(passwdContent))
  for (const username of members) {
    if (!known.has(username)) {
      console.warn(`[subversion] user '${username}' has no entry in ${PASSWD_FILE}; they will get one when they set or reset their password`)
    }
  }
}

// ---------------------------------------------------------------------------
// Password file maintenance
// ---------------------------------------------------------------------------

/** Validate a username for use in the passwd file (no ':' / newlines). */
function assertValidUsername (username) {
  if (!username || typeof username !== 'string' || /[:\r\n]/.test(username)) {
    throw new Error('Invalid username for SVN password sync')
  }
}

/**
 * Add or update a user's credentials in the container's passwd file so they
 * can authenticate against the SVN gateway. Called whenever the service knows
 * a plaintext password: account creation, password updates and resets.
 */
export async function setUserPassword (username, password) {
  assertValidUsername(username)
  if (!password || typeof password !== 'string') throw new Error('Missing password')

  const hash = sha1Hash(password)
  await withWriteLock(async () => {
    const current = await readContainerFile(PASSWD_FILE, { allowMissing: true })
    await writeContainerFile(PASSWD_FILE, upsertPasswdLine(current, username, hash))
  })
}

/**
 * Remove a user's credentials from the container's passwd file. Called when an
 * account is deleted. No-op (but still succeeds) if the user was never synced.
 */
export async function removeUser (username) {
  assertValidUsername(username)

  await withWriteLock(async () => {
    const current = await readContainerFile(PASSWD_FILE, { allowMissing: true })
    const { content } = removePasswdLine(current, username)
    await writeContainerFile(PASSWD_FILE, content)
  })
}
