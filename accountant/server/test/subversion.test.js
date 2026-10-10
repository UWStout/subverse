import { vi } from 'vitest'
import { mockPrisma } from './setup.js'

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
  /** Make `svn info` report a fresh repo (no HEAD revision yet). */
  function mockFreshRepo () {
    const base = execCommand.getMockImplementation()
    execCommand.mockImplementation(async (container, command, input) => {
      if (command[0] === 'svn' && command[1] === 'info') {
        calls.push({ container, command, input })
        return { output: '', error: "svn: E200030: Can't open repository", exitCode: 1 }
      }
      return base(container, command, input)
    })
  }

  it('creates the repo, initial structure, default props and ownership in order', async () => {
    mockContainerFiles()
    mockFreshRepo()

    await subversion.createRepository({ slug: 'my-proj' })

    expect(calls.length).toBe(5)
    expect(calls.every(c => c.container === CONTAINER)).toBe(true)

    // 1. bare repo
    expect(calls[0].command).toEqual(['svnadmin', 'create', '/var/svn/my-proj'])

    // 2. freshness check (no HEAD yet -> import will run)
    expect(calls[1].command).toEqual(['svn', 'info', 'file:///var/svn/my-proj'])

    // 3. monorepo structure as first commit (trunk / branches / tags)
    const initScript = calls[2].command[2]
    expect(calls[2].command[0]).toBe('sh')
    expect(initScript).toContain('mkdir -p /tmp/my-proj-init/trunk /tmp/my-proj-init/branches /tmp/my-proj-init/tags')
    expect(initScript).toContain('svn import /tmp/my-proj-init file:///var/svn/my-proj')

    // 4. default properties (svn:ignore on the repo root)
    const [cmd, , prop, value, url] = calls[3].command
    expect(cmd).toBe('svn')
    expect(prop).toBe('svn:ignore')
    expect(url).toBe('file:///var/svn/my-proj')
    expect(value.split('\n')).toContain('.git')
    expect(value.split('\n')).toContain('Thumbs.db')

    // 5. hand ownership back to apache
    expect(calls[4].command).toEqual(['chown', '-R', 'apache:apache', '/var/svn/my-proj'])
  })

  it('skips the initial import when the repo already has content (repair)', async () => {
    mockContainerFiles() // svn info succeeds -> repo has a HEAD revision

    await subversion.createRepository({ slug: 'my-proj' })

    const scripts = calls.filter(c => c.command[0] === 'sh').map(c => c.command[2])
    expect(scripts.some(s => s.includes('svn import'))).toBe(false)
    // ...but props and ownership are still (re)applied
    expect(calls.some(c => c.command[1] === 'propset')).toBe(true)
    expect(calls[calls.length - 1].command).toEqual(['chown', '-R', 'apache:apache', '/var/svn/my-proj'])
  })

  it('continues past an existing repo directory (interrupted-run repair)', async () => {
    mockContainerFiles()
    const base = execCommand.getMockImplementation()
    execCommand.mockImplementation(async (container, command, input) => {
      if (command[0] === 'svnadmin') {
        return { output: '', error: 'svnadmin: E000031: Repository already exists', exitCode: 1 }
      }
      if (command[0] === 'svn' && command[1] === 'info') {
        return { output: '', error: "svn: E200030: Can't open repository", exitCode: 1 }
      }
      return base(container, command, input)
    })

    await expect(subversion.createRepository({ slug: 'my-proj' })).resolves.toBeUndefined()
    // The import ran despite the pre-existing directory
    expect(calls.some(c => c.command[2]?.includes('svn import'))).toBe(true)
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
