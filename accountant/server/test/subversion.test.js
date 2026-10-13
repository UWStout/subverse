import { vi } from 'vitest'
import os from 'os'
import path from 'path'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { mockPrisma } from './setup.js'
import { PROP_PROFILE } from '../property-sets.js'

// ---------------------------------------------------------------------------
// Load the REAL subversion module (setup.js mocks it for route tests) with a
// mocked docker layer underneath, so we exercise the sync logic without ever
// touching a Docker daemon. db.js is already mocked by setup.js.
// ---------------------------------------------------------------------------
const execCommand = vi.fn()
vi.doMock('../docker.js', () => ({ execCommand }))

const subversion = await vi.importActual('../subversion.js')

/** Container name the module resolves to (mirrors its env lookup). */
const CONTAINER = process.env.SVN_CONTAINER_NAME ?? 'svn_gateway_ur'

const PASSWD_FILE = '/etc/subversion/passwd'
const AUTHZ_FILE = '/etc/subversion/subversion-access-control'

// Default hook templates the real module copies on repository creation.
const HOOKS_DIR = path.resolve(__dirname, '../../config/hooks')
const HOOK_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Names of the default hooks that will actually be installed (sorted). */
async function defaultHookNames () {
  const entries = await readdir(HOOKS_DIR)
  return entries.filter(name => HOOK_NAME_PATTERN.test(name)).sort()
}

/** All execCommand invocations made since the last reset. */
let calls = []

/**
 * Point execCommand at an in-memory set of container files. `cat` reads from
 * it (missing file -> non-zero exit, like a real cat); every other command
 * succeeds. Written files (sh -c 'cat > path' with stdin) are captured.
 */
function mockContainerFiles (files = {}) {
  calls = []
  execCommand.mockImplementation(async (container, command, input) => {
    calls.push({ container, command, input })
    if (command[0] === 'cat') {
      const content = files[command[1]]
      if (content === undefined) {
        return { output: '', error: `cat: can't open '${command[1]}': No such file or directory`, exitCode: 1 }
      }
      return { output: content, error: '', exitCode: 0 }
    }
    return { output: '', error: '', exitCode: 0 }
  })
}

/** Return the stdin content written to `filePath` (or undefined). */
function writtenTo (filePath) {
  const call = calls.find(c => c.input !== undefined && c.command[2]?.includes(`> ${filePath}`))
  return call?.input
}

beforeEach(() => {
  mockContainerFiles()
})

// ---------------------------------------------------------------------------
// Pure config builders
// ---------------------------------------------------------------------------

describe('upsertPasswdLine', () => {
  it('appends a new user to existing content', () => {
    const next = subversion.upsertPasswdLine('alice:$2a$10$alicehash\n', 'bob', '$2a$10$bobhash')
    expect(next).toBe('alice:$2a$10$alicehash\nbob:$2a$10$bobhash\n')
  })

  it('replaces an existing user in place, keeping the other lines', () => {
    const next = subversion.upsertPasswdLine('alice:$2a$10$alicehash\nbob:$2a$10$oldhash\ncarol:$2a$10$carolhash\n', 'bob', '$2a$10$newhash')
    expect(next).toBe('alice:$2a$10$alicehash\nbob:$2a$10$newhash\ncarol:$2a$10$carolhash\n')
  })

  it('handles empty content', () => {
    expect(subversion.upsertPasswdLine('', 'bob', '$2a$10$bobhash')).toBe('bob:$2a$10$bobhash\n')
  })
})

describe('removePasswdLine', () => {
  it('removes the matching user and reports it', () => {
    const { content, removed } = subversion.removePasswdLine('alice:$2a$10$alicehash\nbob:$2a$10$bobhash\n', 'bob')
    expect(removed).toBe(true)
    expect(content).toBe('alice:$2a$10$alicehash\n')
  })

  it('reports no removal when the user is absent', () => {
    const { content, removed } = subversion.removePasswdLine('alice:$2a$10$alicehash\n', 'bob')
    expect(removed).toBe(false)
    expect(content).toBe('alice:$2a$10$alicehash\n')
  })
})

describe('parsePasswdUsernames', () => {
  it('extracts usernames and skips comments / blanks', () => {
    const content = '# comment\n\nalice:$2a$10$alicehash\nbob:$2a$10$bobhash\n'
    expect(subversion.parsePasswdUsernames(content)).toEqual(['alice', 'bob'])
  })

  it('returns [] for empty content', () => {
    expect(subversion.parsePasswdUsernames('')).toEqual([])
  })
})

describe('buildAccessControlFile', () => {
  const projects = [
    {
      slug: 'final-project',
      assignments: [
        { student: { username: 'lellison' } },
        { student: { username: 'rfoster' } }
      ],
      offering: { teacher: { username: 'lito' } }
    },
    {
      slug: 'group-work',
      assignments: [{ student: { username: 'nibarra' } }],
      offering: { teacher: { username: 'sberrier' } }
    }
  ]

  it('builds a group per project plus r/w sections', () => {
    const content = subversion.buildAccessControlFile(projects)
    expect(content).toContain('[groups]')
    expect(content).toContain('final-project = lellison, rfoster, lito')
    expect(content).toContain('group-work = nibarra, sberrier')
    expect(content).toContain('[/]\n@admins = rw')
    expect(content).toContain('[/final-project]\n@final-project = rw')
    expect(content).toContain('[/group-work]\n@group-work = rw')
  })

  it('adds an admins group with universal r/w for ADMIN users', () => {
    const content = subversion.buildAccessControlFile(projects, ['berriers', 'jdoe'])
    expect(content).toContain('admins = berriers, jdoe')
    expect(content).toContain('[/]\n@admins = rw')
  })

  it('never emits a blanket read default', () => {
    const content = subversion.buildAccessControlFile(projects, ['berriers'])
    expect(content).not.toContain('* = r')

    // Without any admins the group line is omitted entirely; the @admins
    // reference then resolves to an empty set (nobody gets universal access),
    // which is exactly the intended lockdown.
    const noAdmins = subversion.buildAccessControlFile(projects)
    expect(noAdmins).not.toMatch(/^admins =/m)
    expect(noAdmins).toContain('[/]\n@admins = rw')
  })

  it('excludes unsafe admin usernames from the group', () => {
    const content = subversion.buildAccessControlFile([], ['ok-admin', 'bad,admin'])
    expect(content).toContain('admins = ok-admin')
    expect(content).not.toContain('bad,admin')
  })

  it('omits groups and sections for projects with no members', () => {
    const content = subversion.buildAccessControlFile([
      { slug: 'empty-proj', assignments: [], offering: { teacher: null } },
      ...projects
    ])
    expect(content).not.toContain('empty-proj')
    expect(content).toContain('[/final-project]')
  })

  it('excludes usernames that are unsafe in authz syntax', () => {
    const content = subversion.buildAccessControlFile([
      {
        slug: 'odd-names',
        assignments: [
          { student: { username: 'bad,name' } },
          { student: { username: 'good_name' } }
        ],
        offering: { teacher: { username: 'lito' } }
      }
    ])
    expect(content).toContain('odd-names = good_name, lito')
    expect(content).not.toContain('bad,name')
  })

  it('deduplicates a user who is both assigned and the teacher', () => {
    const content = subversion.buildAccessControlFile([
      {
        slug: 'self-taught',
        assignments: [{ student: { username: 'lito' } }],
        offering: { teacher: { username: 'lito' } }
      }
    ])
    expect(content).toContain('self-taught = lito')
  })
})

// ---------------------------------------------------------------------------
// Repository lifecycle (orchestration of container commands)
// ---------------------------------------------------------------------------

describe('createRepository', () => {
  /** Make the /trunk probe report a fresh repo (no structure committed yet). */
  function mockFreshRepo () {
    const base = execCommand.getMockImplementation()
    execCommand.mockImplementation(async (container, command, input) => {
      if (command[0] === 'svn' && command[1] === 'info' && String(command[2]).endsWith('/trunk')) {
        calls.push({ container, command, input })
        return { output: '', error: "svn: E200013: Path 'file:///var/svn/my-proj/trunk' does not exist", exitCode: 1 }
      }
      return base(container, command, input)
    })
  }

  it('creates the repo, installs default hooks, initial structure, default props and ownership in order', async () => {
    mockContainerFiles()
    mockFreshRepo()
    const hookNames = await defaultHookNames()

    await subversion.createRepository({ slug: 'my-proj' })

    // svnadmin create + (write, chmod) per default hook + trunk probe,
    // import, one value file per profile property, props script, chown
    expect(calls.length).toBe(1 + hookNames.length * 2 + 6)
    expect(calls.every(c => c.container === CONTAINER)).toBe(true)

    // 1. bare repo
    expect(calls[0].command).toEqual(['svnadmin', 'create', '/var/svn/my-proj'])

    // 2. hooks: installed immediately after creation, each template written
    //    via stdin (never shell-quoted) and marked executable right away,
    //    in sorted name order
    for (let i = 0; i < hookNames.length; i++) {
      const name = hookNames[i]
      const target = `/var/svn/my-proj/hooks/${name}`
      expect(calls[1 + i * 2].command).toEqual(['sh', '-c', `cat > ${target}`])
      expect(calls[1 + i * 2].input).toBe(await readFile(path.join(HOOKS_DIR, name), 'utf8'))
      expect(calls[2 + i * 2].command).toEqual(['chmod', '755', target])
    }

    const rest = calls.slice(1 + hookNames.length * 2)

    // 3. freshness check: probe <repo>/trunk (a bare-repo `svn info` exits 0
    //    even when the repo is empty, so only the /trunk probe can tell a
    //    fresh repo from one that already has structure)
    expect(rest[0].command).toEqual(['svn', 'info', 'file:///var/svn/my-proj/trunk'])

    // 4. monorepo structure as first commit (trunk / branches / tags)
    const initScript = rest[1].command[2]
    expect(rest[1].command[0]).toBe('sh')
    expect(initScript).toContain('mkdir -p /tmp/my-proj-init/trunk /tmp/my-proj-init/branches /tmp/my-proj-init/tags')
    expect(initScript).toContain('svn import /tmp/my-proj-init file:///var/svn/my-proj')

    // 5. each profile property's multi-line value is fed to a file via stdin
    //    so it never has to be shell-quoted - one file per property, in
    //    profile order (svn:global-ignores, then svn:auto-props). A plain
    //    'default' type applies the base profile unchanged.
    expect(rest[2].command).toEqual(['sh', '-c', 'cat > /tmp/my-proj-value-1.txt'])
    expect(writtenTo('/tmp/my-proj-value-1.txt')).toBe(PROP_PROFILE.base['svn:global-ignores'].join('\n'))
    expect(rest[3].command).toEqual(['sh', '-c', 'cat > /tmp/my-proj-value-2.txt'])
    expect(writtenTo('/tmp/my-proj-value-2.txt')).toBe(PROP_PROFILE.base['svn:auto-props'].join('\n'))

    // 6. a throwaway working copy is checked out, both properties are set
    //    from the value files on trunk (propset refuses bare repository URLs
    //    with E200009) and committed
    const propsScript = rest[4].command[2]
    expect(rest[4].command[0]).toBe('sh')
    expect(propsScript).toContain('svn checkout file:///var/svn/my-proj /tmp/my-proj-props -q --non-interactive')
    expect(propsScript).toContain('svn propset svn:global-ignores --file /tmp/my-proj-value-1.txt /tmp/my-proj-props/trunk')
    expect(propsScript).toContain('svn propset svn:auto-props --file /tmp/my-proj-value-2.txt /tmp/my-proj-props/trunk')
    expect(propsScript).toContain('svn commit')

    // 8. hand ownership back to apache (covers the hook scripts too)
    expect(rest[5].command).toEqual(['chown', '-R', 'apache:apache', '/var/svn/my-proj'])
  })

  it('skips the initial import when the repo already has content (repair)', async () => {
    mockContainerFiles() // /trunk probe succeeds -> structure already exists

    await subversion.createRepository({ slug: 'my-proj' })

    const scripts = calls.filter(c => c.command[0] === 'sh').map(c => c.command[2])
    expect(scripts.some(s => s.includes('svn import'))).toBe(false)
    // ...but props and ownership are still (re)applied
    expect(scripts.some(s => s.includes('svn checkout file:///var/svn/my-proj /tmp/my-proj-props'))).toBe(true)
    expect(scripts.some(s => s.includes('svn propset svn:global-ignores --file'))).toBe(true)
    expect(calls[calls.length - 1].command).toEqual(['chown', '-R', 'apache:apache', '/var/svn/my-proj'])
  })

  it('re-applies default properties on repeated runs (no skip-if-matches)', async () => {
    // First run on an already-structured repo (probe succeeds -> import skipped)
    mockContainerFiles()
    await subversion.createRepository({ slug: 'my-proj' })

    // Second consecutive run: the property script is rebuilt and re-committed
    // unconditionally - there is no read-back/skip optimization
    mockContainerFiles()
    await subversion.createRepository({ slug: 'my-proj' })

    const scripts = calls.filter(c => c.command[0] === 'sh').map(c => c.command[2])
    expect(scripts.some(s => s.includes('svn propset svn:global-ignores --file'))).toBe(true)
    expect(scripts.some(s => s.includes('svn commit'))).toBe(true)
    expect(scripts.some(s => s.includes('svn import'))).toBe(false)
  })

  it('keeps type-specific profiles isolated between creations (no shared-state mutation)', async () => {
    // Snapshot the pristine base profile before any creation runs - expected
    // values must be computed from this, not from PROP_PROFILE.base at assert
    // time (a mutating merge would poison both sides of a naive comparison).
    const pristineBaseIgnores = [...PROP_PROFILE.base['svn:global-ignores']]

    // First project: Godot. Its svn:global-ignores is base + GODOT.
    mockContainerFiles()
    await subversion.createRepository({ slug: 'godot-proj', type: 'GODOT' })
    const firstGodotIgnores = writtenTo('/tmp/godot-proj-value-1.txt')
    expect(firstGodotIgnores.split('\n')).toEqual([
      ...pristineBaseIgnores,
      ...PROP_PROFILE.GODOT['svn:global-ignores']
    ])

    // Second project of the SAME type: identical value. A merge that mutates
    // the shared base would append the Godot entries a second time.
    mockContainerFiles()
    await subversion.createRepository({ slug: 'godot-proj-2', type: 'GODOT' })
    expect(writtenTo('/tmp/godot-proj-2-value-1.txt')).toBe(firstGodotIgnores)

    // Third project of a DIFFERENT type: must not inherit Godot entries.
    mockContainerFiles()
    await subversion.createRepository({ slug: 'unity-proj', type: 'UNITY_ENGINE' })
    const unityIgnores = writtenTo('/tmp/unity-proj-value-1.txt').split('\n')
    expect(unityIgnores).toEqual([
      ...pristineBaseIgnores,
      ...PROP_PROFILE.UNITY_ENGINE['svn:global-ignores']
    ])
    expect(unityIgnores).not.toContain('.godot/')
  })

  it('continues past an existing repo directory (interrupted-run repair)', async () => {
    mockContainerFiles()
    const base = execCommand.getMockImplementation()
    execCommand.mockImplementation(async (container, command, input) => {
      if (command[0] === 'svnadmin') {
        return { output: '', error: 'svnadmin: E000031: Repository already exists', exitCode: 1 }
      }
      if (command[0] === 'svn' && command[1] === 'info' && String(command[2]).endsWith('/trunk')) {
        return { output: '', error: 'svn: E200013: Path does not exist', exitCode: 1 }
      }
      return base(container, command, input)
    })

    await expect(subversion.createRepository({ slug: 'my-proj' })).resolves.toBeUndefined()
    // The import ran despite the pre-existing directory
    expect(calls.some(c => c.command[2]?.includes('svn import'))).toBe(true)
    // ...and the default hooks are (re)installed while repairing
    expect(calls.some(c => c.command[2]?.includes('> /var/svn/my-proj/hooks/'))).toBe(true)
  })

  it('rejects a missing or malformed slug', async () => {
    await expect(subversion.createRepository({})).rejects.toThrow(/slug/)
    await expect(subversion.createRepository({ slug: 'Bad/Slug' })).rejects.toThrow(/slug/)
    expect(calls.length).toBe(0)
  })

  it('throws with stderr detail when a command fails', async () => {
    execCommand.mockImplementation(async (container, command) => ({
      output: '',
      error: 'svnadmin: run as root owned by a different user',
      exitCode: command[0] === 'svnadmin' ? 1 : 0
    }))

    await expect(subversion.createRepository({ slug: 'my-proj' })).rejects.toThrow(/svnadmin/)
  })
})

describe('installDefaultHooks', () => {
  afterEach(() => {
    delete process.env.SVN_HOOKS_DIR
  })

  it('copies every default hook into <repo>/hooks and marks it executable', async () => {
    mockContainerFiles()
    const hookNames = await defaultHookNames()
    expect(hookNames.length).toBeGreaterThan(0)

    await subversion.installDefaultHooks('my-proj')

    for (const name of hookNames) {
      const target = `/var/svn/my-proj/hooks/${name}`
      expect(writtenTo(target)).toBe(await readFile(path.join(HOOKS_DIR, name), 'utf8'))
      expect(calls.some(c => c.command.join(' ') === `chmod 755 ${target}`)).toBe(true)
    }
  })

  it('normalizes CRLF line endings before writing', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'svn-hooks-'))
    try {
      await writeFile(path.join(tmpDir, 'pre-commit'), '#!/bin/sh\r\nexit 0\r\n')
      process.env.SVN_HOOKS_DIR = tmpDir

      mockContainerFiles()
      await subversion.installDefaultHooks('my-proj')

      expect(writtenTo('/var/svn/my-proj/hooks/pre-commit')).toBe('#!/bin/sh\nexit 0\n')
    } finally {
      delete process.env.SVN_HOOKS_DIR
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('installs from SVN_HOOKS_DIR when set and skips non-hook files', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'svn-hooks-'))
    try {
      await writeFile(path.join(tmpDir, 'pre-commit'), '#!/bin/sh\nexit 0\n')
      await writeFile(path.join(tmpDir, 'README.md'), 'not a hook\n')
      process.env.SVN_HOOKS_DIR = tmpDir

      mockContainerFiles()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await subversion.installDefaultHooks('my-proj')

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('README.md'))
      expect(writtenTo('/var/svn/my-proj/hooks/pre-commit')).toBe('#!/bin/sh\nexit 0\n')
      // only the single valid hook: write + chmod
      expect(calls.length).toBe(2)
      warn.mockRestore()
    } finally {
      delete process.env.SVN_HOOKS_DIR
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('warns and installs nothing when the template folder is missing', async () => {
    process.env.SVN_HOOKS_DIR = '/nonexistent/hooks-folder'

    mockContainerFiles()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await subversion.installDefaultHooks('my-proj')

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/nonexistent/hooks-folder'))
    expect(calls.length).toBe(0)
    warn.mockRestore()
  })

  it('rejects a malformed repository name', async () => {
    mockContainerFiles()
    await expect(subversion.installDefaultHooks('Bad/Name')).rejects.toThrow(/repository name/)
    expect(calls.length).toBe(0)
  })
})

describe('renameRepository / deleteRepository', () => {
  it('renames by dump/load and chowns the new repo', async () => {
    mockContainerFiles()

    await subversion.renameRepository('old-name', 'new-name')

    expect(calls[0].command).toEqual(['svnadmin', 'create', '/var/svn/new-name'])
    expect(calls[1].command[2]).toContain('svnadmin dump /var/svn/old-name | svnadmin load /var/svn/new-name')
    expect(calls[1].command[2]).toContain('rm -rf /var/svn/old-name')
    expect(calls[2].command).toEqual(['chown', '-R', 'apache:apache', '/var/svn/new-name'])
  })

  it('deletes the repo directory and rebuilds the authz file', async () => {
    mockContainerFiles()
    mockPrisma.project.findMany.mockResolvedValue([])

    await subversion.deleteRepository('old-name')

    const rm = calls.find(c => c.command[0] === 'sh' && c.command[2]?.includes('rm -rf /var/svn/old-name'))
    expect(rm).toBeDefined()
    expect(writtenTo(AUTHZ_FILE)).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Access synchronization
// ---------------------------------------------------------------------------

describe('synchronizeRepositoryAccess', () => {
  const dbProjects = [
    {
      slug: 'final-project',
      assignments: [{ student: { username: 'lellison' } }],
      offering: { teacher: { username: 'lito' } }
    },
    {
      slug: 'other-proj',
      assignments: [],
      offering: { teacher: { username: 'sberrier' } }
    }
  ]

  /** Member accounts as the database would return them for the final-project team. */
  const memberAccounts = [
    { username: 'lellison', password_hash: '$2a$10$lellisonhash' },
    { username: 'lito', password_hash: '$2a$10$litohash' }
  ]

  /**
   * Route user.findMany by query shape: the admins lookup filters on
   * `type: 'ADMIN'`, the member-credentials lookup on `username.in`.
   */
  function mockUserLookups (admins = [], accounts = []) {
    mockPrisma.user.findMany.mockImplementation(({ where } = {}) => {
      if (where?.type === 'ADMIN') return Promise.resolve(admins)
      return Promise.resolve(accounts)
    })
  }

  it('rebuilds the authz file from the full database state', async () => {
    mockContainerFiles({ [PASSWD_FILE]: 'lellison:$2a$10$lellisonhash\nlito:$2a$10$litohash\n' })
    mockPrisma.project.findMany.mockResolvedValue(dbProjects)
    mockUserLookups([], memberAccounts)

    await subversion.synchronizeRepositoryAccess({ slug: 'final-project' })

    const content = writtenTo(AUTHZ_FILE)
    expect(content).toBe(subversion.buildAccessControlFile(dbProjects))
    expect(content).toContain('final-project = lellison, lito')
    expect(content).toContain('[/final-project]\n@final-project = rw')
  })

  it('is a no-op for the passwd file when entries already match the database', async () => {
    mockContainerFiles({ [PASSWD_FILE]: 'lellison:$2a$10$lellisonhash\nlito:$2a$10$litohash\n' })
    mockPrisma.project.findMany.mockResolvedValue(dbProjects)
    mockUserLookups([], memberAccounts)

    await subversion.synchronizeRepositoryAccess({ slug: 'final-project' })

    expect(writtenTo(PASSWD_FILE)).toBeUndefined()
  })

  it('syncs members\' hashes into the passwd file, adding missing entries and migrating legacy lines', async () => {
    mockContainerFiles({ [PASSWD_FILE]: 'lellison:{SHA}legacy\nsberrier:$2a$10$sberrierhash\n' }) // lito missing
    mockPrisma.project.findMany.mockResolvedValue(dbProjects)
    mockUserLookups([], memberAccounts)

    await subversion.synchronizeRepositoryAccess({ slug: 'final-project' })

    expect(writtenTo(PASSWD_FILE)).toBe(
      'lellison:$2a$10$lellisonhash\nsberrier:$2a$10$sberrierhash\nlito:$2a$10$litohash\n'
    )
  })

  it('includes ADMIN users from the database in the admins group', async () => {
    mockContainerFiles({ [PASSWD_FILE]: 'lellison:$2a$10$lellisonhash\nlito:$2a$10$litohash\n' })
    mockPrisma.project.findMany.mockResolvedValue(dbProjects)
    mockUserLookups([{ username: 'berriers' }, { username: 'jdoe' }], memberAccounts)

    await subversion.synchronizeRepositoryAccess({ slug: 'final-project' })

    const content = writtenTo(AUTHZ_FILE)
    expect(content).toContain('admins = berriers, jdoe')
    expect(content).toContain('[/]\n@admins = rw')
    expect(content).not.toContain('* = r')
  })

  it('warns about members that have no database account', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockContainerFiles({ [PASSWD_FILE]: 'lellison:$2a$10$lellisonhash\n' })
    mockPrisma.project.findMany.mockResolvedValue(dbProjects)
    mockUserLookups([], memberAccounts.filter(a => a.username === 'lellison')) // lito has no account

    await subversion.synchronizeRepositoryAccess({ slug: 'final-project' })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'lito'"))
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("'lellison'"))
    warn.mockRestore()
  })

  it('creates the passwd file when it does not exist yet', async () => {
    mockContainerFiles() // no passwd file at all
    mockPrisma.project.findMany.mockResolvedValue(dbProjects)
    mockUserLookups([], memberAccounts)

    await subversion.synchronizeRepositoryAccess({ slug: 'final-project' })

    expect(writtenTo(PASSWD_FILE)).toBe('lellison:$2a$10$lellisonhash\nlito:$2a$10$litohash\n')
  })

  it('rejects a missing or malformed slug', async () => {
    await expect(subversion.synchronizeRepositoryAccess({})).rejects.toThrow(/slug/)
    expect(calls.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Password file maintenance
// ---------------------------------------------------------------------------

describe('setUserPassword', () => {
  const BCRYPT_HASH = '$2a$10$abcdefghijklmnopqrstuv'

  it('adds a new user to the passwd file, preserving existing entries', async () => {
    mockContainerFiles({ [PASSWD_FILE]: 'alice:$2a$10$alicehash\n' })

    await subversion.setUserPassword('bob', BCRYPT_HASH)

    expect(writtenTo(PASSWD_FILE)).toBe(`alice:$2a$10$alicehash\nbob:${BCRYPT_HASH}\n`)
  })

  it('replaces an existing user when their password changes', async () => {
    mockContainerFiles({ [PASSWD_FILE]: 'bob:$2a$10$oldhash\n' })

    await subversion.setUserPassword('bob', BCRYPT_HASH)

    expect(writtenTo(PASSWD_FILE)).toBe(`bob:${BCRYPT_HASH}\n`)
  })

  it('creates the file when it does not exist yet', async () => {
    mockContainerFiles() // no passwd file

    await subversion.setUserPassword('bob', BCRYPT_HASH)

    expect(writtenTo(PASSWD_FILE)).toBe(`bob:${BCRYPT_HASH}\n`)
  })

  it('rejects invalid usernames or missing passwords', async () => {
    await expect(subversion.setUserPassword('', 'x')).rejects.toThrow(/username/i)
    await expect(subversion.setUserPassword('bad:user', 'x')).rejects.toThrow(/username/i)
    await expect(subversion.setUserPassword('bob', '')).rejects.toThrow(/password/i)
    expect(calls.length).toBe(0)
  })

  it('refuses to write plaintext or legacy-format values', async () => {
    await expect(subversion.setUserPassword('bob', 'hunter2')).rejects.toThrow(/bcrypt/i)
    await expect(subversion.setUserPassword('bob', '{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=')).rejects.toThrow(/bcrypt/i)
    await expect(subversion.setUserPassword('bob', '$apr1$JUtdOL.O$gc70nnNq4JxstytGe/HLQ1')).rejects.toThrow(/bcrypt/i)
    expect(calls.length).toBe(0)
  })
})

describe('removeUser', () => {
  it('removes the user and keeps the rest of the file', async () => {
    mockContainerFiles({ [PASSWD_FILE]: 'alice:$2a$10$alicehash\nbob:$2a$10$bobhash\ncarol:$2a$10$carolhash\n' })

    await subversion.removeUser('bob')

    expect(writtenTo(PASSWD_FILE)).toBe('alice:$2a$10$alicehash\ncarol:$2a$10$carolhash\n')
  })

  it('succeeds (no write needed for unknown users) when the user is absent', async () => {
    mockContainerFiles({ [PASSWD_FILE]: 'alice:$2a$10$alicehash\n' })

    await subversion.removeUser('ghost')

    // The file is still rewritten with identical content - harmless and keeps
    // the code path uniform.
    expect(writtenTo(PASSWD_FILE)).toBe('alice:$2a$10$alicehash\n')
  })
})

// ---------------------------------------------------------------------------
// bestEffortSvn
// ---------------------------------------------------------------------------

describe('bestEffortSvn', () => {
  it('swallows failures from the sync operation', async () => {
    const error = new Error('container unreachable')
    await expect(
      subversion.bestEffortSvn('test label', async () => { throw error })
    ).resolves.toBeUndefined()
  })

  it('awaits successful operations', async () => {
    let ran = false
    await subversion.bestEffortSvn('ok', async () => { ran = true })
    expect(ran).toBe(true)
  })
})
