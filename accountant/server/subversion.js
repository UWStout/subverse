import 'dotenv/config'
import { readdir, readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { execCommand } from './docker.js'
import { getDatabase } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SVN_CONTAINER_NAME = process.env.SVN_CONTAINER_NAME ?? 'svn_gateway_ur'

// Paths inside the SVN container (see subversion/docker-compose.yaml and
// config/apache2-gateway/conf.d/dav_svn.conf - the same files are mounted
// into both the gateway and admin containers).
const SVN_ROOT = '/var/svn'
const PASSWD_FILE = '/etc/subversion/passwd'
const AUTHZ_FILE = '/etc/subversion/subversion-access-control'

// Default commit-hook templates live in a common folder on the client side
// (this service), not inside the SVN container image. Every repository is
// created with copies of these scripts in <repo>/hooks/, so hook behaviour
// can be changed by editing one folder - no image rebuild required. Set
// SVN_HOOKS_DIR to use custom templates; a missing or empty folder installs
// nothing.
const HOOKS_SOURCE_DIR = path.resolve(__dirname, '../config/hooks')

// Valid SVN hook names: lowercase alphanumerics separated by single hyphens
// (pre-commit, post-revprop-change, ...). Anything else in the template
// folder is ignored - the name is embedded in container file paths.
const HOOK_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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
 * Shape of the bcrypt hashes stored in the database ($2a$/$2b$/$2y$, cost,
 * salt + digest). The passwd file carries these values verbatim and
 * mod_authn_file verifies them natively; the pattern guards against ever
 * writing a plaintext or legacy-format value into the file.
 */
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/

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
 * Install the default commit hooks into a freshly created repository by
 * copying every script from the common template folder (config/hooks) into
 * <repo>/hooks/ and marking it executable. Called immediately after
 * `svnadmin create`; createRepository's final chown then hands the scripts
 * to apache along with the rest of the repository, which is the user the
 * hooks run as when commits arrive through WebDAV.
 *
 * Only regular files whose names look like SVN hook names are installed;
 * anything else in the folder is skipped with a warning. A missing or empty
 * template folder is not an error - the repository is created without hooks.
 * Re-running on an existing repository (interrupted-run repair) refreshes
 * its scripts to the current defaults.
 *
 * @param {string} repoName
 */
export async function installDefaultHooks (repoName) {
  if (!repoName || !REPO_NAME_PATTERN.test(repoName)) {
    throw new Error('Missing or invalid repository name')
  }

  const hooksDir = process.env.SVN_HOOKS_DIR ?? HOOKS_SOURCE_DIR
  let entries
  try {
    entries = await readdir(hooksDir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`[subversion] hooks folder '${hooksDir}' not found - creating '${repoName}' without default hooks`)
      return
    }
    throw err
  }

  for (const name of entries.filter(entry => entry.isFile()).map(entry => entry.name).sort()) {
    if (!HOOK_NAME_PATTERN.test(name)) {
      console.warn(`[subversion] ignoring '${name}' in ${hooksDir}: not a valid SVN hook name`)
      continue
    }
    // Normalize line endings: the templates must reach the container as LF
    // regardless of how they were checked out or edited (CRLF breaks sh).
    const content = (await readFile(path.join(hooksDir, name), 'utf8')).replace(/\r\n/g, '\n')
    const target = `${SVN_ROOT}/${repoName}/hooks/${name}`
    await writeContainerFile(target, content)
    await runInContainer(['chmod', '755', target])
  }
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

  // Install the default commit hooks (copied from the common template folder)
  // while still running as root; the chown at the end of this function hands
  // them to apache with everything else. On an interrupted-run repair this
  // refreshes any stale scripts to the current defaults.
  await installDefaultHooks(repoName)

  // Apply the standard monorepo structure: trunk / branches / tags folders
  // committed as the very first revision. A throwaway directory is imported so
  // the whole layout lands in a single initial commit. Skipped when trunk
  // already exists (interrupted-run repair). The probe targets <repo>/trunk
  // rather than the repo URL itself: `svn info` on a fresh empty repository
  // still exits 0, so only the /trunk probe can tell "fresh" from
  // "already structured".
  const trunkProbe = await execCommand(SVN_CONTAINER_NAME, ['svn', 'info', `${repoUrl(repoName)}/trunk`])
  if (trunkProbe.exitCode !== 0) {
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
 *   - svn:ignore on the repository root. `svn propset` only accepts working
 *     copy targets (a bare repository URL is rejected with E200009), so the
 *     value is set through a throwaway empty-depth checkout and committed as
 *     its own revision. The current value is read first with `svn propget`,
 *     which does accept URLs, so re-running on an existing repo (interrupted-
 *     run repair) is a no-op instead of stacking another revision.
 *   - svn:needs-lock: Subversion has no repository-wide default for this
 *     property - it must be set on each individual file. The repo is still
 *     empty at creation time, so there is nothing to tag yet; the profile's
 *     `needsLock` extensions document what should be tagged, and
 *     tagNeedsLock() applies it whenever content lands (e.g. a teacher import).
 */
async function applyDefaultProperties (repoName, projectType) {
  const profile = PROP_PROFILES[projectType] ?? PROP_PROFILES.default
  const desired = profile.ignore.join('\n')

  // propget accepts repository URLs; a non-zero exit simply means the
  // property is not set yet. Trailing whitespace is normalized because
  // propget's rendering of the stored value may or may not carry a final
  // newline depending on how it was originally written.
  const current = await execCommand(SVN_CONTAINER_NAME, ['svn', 'propget', 'svn:ignore', repoUrl(repoName)])
  if (current.exitCode === 0 && current.output.replace(/\s+$/, '') === desired) {
    return // already in place - nothing to commit
  }

  const wcDir = `/tmp/${repoName}-props`
  const valueFile = `/tmp/${repoName}-ignore.txt`

  // Feed the multi-line value through stdin so it never has to be quoted in
  // a shell command line; propset then reads it with --file.
  await writeContainerFile(valueFile, desired)

  await runInContainer(['sh', '-c', [
    `rm -rf ${wcDir}`,
    `svn checkout --depth empty ${repoUrl(repoName)} ${wcDir} -q --non-interactive`,
    `svn propset svn:ignore --file ${valueFile} ${wcDir}`,
    `svn commit -m "Set default svn:ignore properties" ${wcDir} -q --non-interactive`,
    `rm -rf ${wcDir} ${valueFile}`
  ].join(' && ')])
}

/**
 * Tag existing paths in a repository with svn:needs-lock (files must be locked
 * before they can be modified). Use this when content is added to a repo, for
 * example after a teacher imports starter files - tag the binary/media
 * extensions listed in PROP_PROFILES.
 *
 * `svn propset` only accepts working copy targets, so the requested nodes are
 * fetched into a throwaway sparse checkout (only the touched paths are
 * downloaded) and committed from there. Paths that do not exist or are not
 * plain files are skipped with a warning.
 *
 * @param {string} repoName
 * @param {string[]} relativePaths Paths relative to the repository root.
 */
export async function tagNeedsLock (repoName, relativePaths) {
  if (!repoName || !REPO_NAME_PATTERN.test(repoName)) {
    throw new Error('Missing or invalid repository name')
  }

  const paths = [...new Set((relativePaths ?? [])
    .map(path => String(path).replace(/^\/+/, ''))
    .filter(Boolean))]
  if (paths.length === 0) return

  // Probe each path through the URL: `svn cat` only succeeds for existing
  // files, so this doubles as an existence + kind check.
  const taggable = []
  for (const path of paths) {
    const probe = await execCommand(SVN_CONTAINER_NAME, ['svn', 'cat', `${repoUrl(repoName)}/${path}`])
    if (probe.exitCode !== 0) {
      console.warn(`[subversion] skipping svn:needs-lock for '${path}' in '${repoName}': not a file in the repository`)
      continue
    }
    taggable.push(path)
  }
  if (taggable.length === 0) return

  const wcDir = `/tmp/${repoName}-needslock`

  // A sparse checkout only knows about nodes it has fetched, so every target's
  // ancestor directories must be brought in (depth empty) before the file
  // itself can be updated. Collect each unique prefix across all paths;
  // lexicographic order guarantees parents are fetched before children.
  const prefixes = new Set()
  for (const path of taggable) {
    const segments = path.split('/')
    for (let i = 1; i < segments.length; i++) {
      prefixes.add(segments.slice(0, i).join('/'))
    }
  }

  await runInContainer(['sh', '-c', [
    `rm -rf ${wcDir}`,
    `svn checkout --depth empty ${repoUrl(repoName)} ${wcDir} -q --non-interactive`,
    ...[...prefixes].sort().map(prefix => `svn update --set-depth empty "${wcDir}/${prefix}" -q --non-interactive`),
    ...taggable.map(path => `svn update "${wcDir}/${path}" -q --non-interactive`),
    ...taggable.map(path => `svn propset svn:needs-lock true "${wcDir}/${path}"`),
    `svn commit -m "Tag files with svn:needs-lock" ${wcDir} -q --non-interactive`,
    `rm -rf ${wcDir}`
  ].join(' && ')])
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
 * Synchronizes the SVN access configuration with a project's current team:
 * rebuilds the authz file from the full database state and makes sure every
 * member of THIS project has a passwd-file entry carrying their database
 * bcrypt hash.
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
  // needs a line in the passwd file carrying the same bcrypt hash as their
  // database row. Accounts that exist are (re)synced verbatim - which also
  // migrates legacy-format entries left behind by earlier versions; members
  // without a usable database account are only reported.
  const fresh = projects.find(p => p.slug === repoName) ?? projectInfo

  const members = new Set()
  for (const assignment of fresh.assignments ?? []) {
    if (assignment?.student?.username) members.add(assignment.student.username)
  }
  if (fresh.offering?.teacher?.username) members.add(fresh.offering.teacher.username)

  const accounts = members.size > 0
    ? await db.user.findMany({
      where: { username: { in: [...members] } },
      select: { username: true, password_hash: true }
    })
    : []

  for (const username of members) {
    if (!accounts.some(account => account.username === username)) {
      console.warn(`[subversion] user '${username}' has no account in the database; they cannot authenticate until one exists`)
    }
  }

  await withWriteLock(async () => {
    const current = await readContainerFile(PASSWD_FILE, { allowMissing: true })
    let next = current
    for (const account of accounts) {
      if (!BCRYPT_HASH_PATTERN.test(account.password_hash ?? '')) continue
      next = upsertPasswdLine(next, account.username, account.password_hash)
    }
    // Skip the write when nothing changed - keeps repeated syncs cheap and
    // avoids bumping the file's mtime for no reason.
    if (next !== current) {
      await writeContainerFile(PASSWD_FILE, next)
    }
  })
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
 * can authenticate against the SVN gateway. The account's bcrypt hash - the
 * same value stored in the database - is written verbatim; mod_authn_file
 * verifies bcrypt natively, so no hashing happens here. Called from every
 * flow that stores a fresh hash (create / update / reset).
 */
export async function setUserPassword (username, passwordHash) {
  assertValidUsername(username)
  if (!passwordHash || typeof passwordHash !== 'string') throw new Error('Missing password hash')
  if (!BCRYPT_HASH_PATTERN.test(passwordHash)) {
    throw new Error('Password is not a bcrypt hash - refusing to write it to the SVN passwd file')
  }

  await withWriteLock(async () => {
    const current = await readContainerFile(PASSWD_FILE, { allowMissing: true })
    await writeContainerFile(PASSWD_FILE, upsertPasswdLine(current, username, passwordHash))
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
