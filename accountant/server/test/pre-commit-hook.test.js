import os from 'os'
import path from 'path'
import { mkdir, mkdtemp, readFile, rm, writeFile, chmod } from 'fs/promises'
import { spawnSync } from 'child_process'

// ---------------------------------------------------------------------------
// The pre-commit hook is a POSIX sh script deployed into SVN repositories.
// It is tested by running the REAL script under a shell with a fake `svnlook`
// on the PATH, so the full logic (message validation + file size check) is
// exercised without needing Subversion. The suite skips itself on platforms
// without a usable shell (e.g. bare CI images).
// ---------------------------------------------------------------------------

const HOOKS_DIR = path.resolve(__dirname, '../../config/hooks')

/** First of sh/dash/bash that can actually run - null when none is found. */
function findSh () {
  for (const candidate of ['sh', 'dash', 'bash']) {
    const probe = spawnSync(candidate, ['-c', 'echo ok'], { encoding: 'utf8' })
    if (!probe.error && probe.status === 0) return candidate
  }
  return null
}

const SH = findSh()

describe.skipIf(!SH)('pre-commit hook (config/hooks/pre-commit)', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'svn-hook-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  /**
   * Run the real pre-commit hook against a fake svnlook. The hook is
   * invoked with the same argument contract as Subversion: $1 = repository
   * path, $2 = transaction name (TXN is NOT an environment variable in this
   * build). The fake answers `log` with FAKE_LOG_FILE, `changed` with
   * FAKE_CHANGED_FILE, and `cat` with FAKE_CAT_FILE - but only when the
   * requested path equals FAKE_BIG_FILE (anything else fails like a real cat
   * on a directory or missing file), and every subcommand fails on an empty
   * transaction name just like the real svnlook. Defaults model an empty
   * transaction. Returns { status, stderr }.
   */
  async function runHook ({ message = '', changed = '', catContent = '', catForPath = null, extraEnv = {}, hookPath, repoDir = null } = {}) {
    const binDir = path.join(tmpDir, 'bin')
    await mkdir(binDir, { recursive: true })
    const fakeSvnlook = [
      '#!/bin/sh',
      'case "$1" in',
      '  log)',
      '    [ -n "$3" ] || exit 1',
      '    cat "$FAKE_LOG_FILE" 2>/dev/null ;;',
      '  changed)',
      '    [ -n "$3" ] || exit 1',
      '    cat "$FAKE_CHANGED_FILE" 2>/dev/null ;;',
      '  cat)',
      '    [ -n "$3" ] || exit 1',
      '    if [ -n "$FAKE_BIG_FILE" ] && [ "$5" = "$FAKE_BIG_FILE" ]; then cat "$FAKE_CAT_FILE" 2>/dev/null; else exit 1; fi ;;',
      'esac',
      'exit 0'
    ].join('\n') + '\n'

    await writeFile(path.join(tmpDir, 'log.txt'), message)
    await writeFile(path.join(tmpDir, 'changed.txt'), changed)
    await writeFile(path.join(tmpDir, 'catfile'), catContent)
    await writeFile(path.join(binDir, 'svnlook'), fakeSvnlook)
    await chmod(path.join(binDir, 'svnlook'), 0o755)

    const result = spawnSync(SH, [hookPath ?? path.join(HOOKS_DIR, 'pre-commit'), repoDir ?? '/fake/repo', 'txn123'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        SVNLOOK: path.join(binDir, 'svnlook'),
        FAKE_LOG_FILE: path.join(tmpDir, 'log.txt'),
        FAKE_CHANGED_FILE: path.join(tmpDir, 'changed.txt'),
        FAKE_CAT_FILE: path.join(tmpDir, 'catfile'),
        FAKE_BIG_FILE: catForPath ?? '',
        ...extraEnv
      }
    })
    return { status: result.status, stderr: (result.stderr ?? '').trim() }
  }

  /**
   * Copy of the hook with the MB limit scaled down to bytes so an oversized
   * file can be simulated without generating hundreds of megabytes.
   */
  async function runHookWithByteLimit (options) {
    const hookCopy = path.join(tmpDir, 'pre-commit-bytes')
    const original = await readFile(path.join(HOOKS_DIR, 'pre-commit'), 'utf8')
    await writeFile(hookCopy, original.replace('MAX_MB * 1024 * 1024', 'MAX_MB'))
    return runHook({ ...options, hookPath: hookCopy })
  }

  describe('log message validation', () => {
    it('rejects an empty commit message', async () => {
      const { status, stderr } = await runHook({ message: '' })
      expect(status).toBe(1)
      expect(stderr).toContain('commit message is empty')
    })

    it('treats whitespace- and punctuation-only messages as empty', async () => {
      for (const message of ['   \n  ', '!!!']) {
        const { status, stderr } = await runHook({ message })
        expect(status).toBe(1)
        expect(stderr).toContain('commit message is empty')
      }
    })

    it('rejects messages shorter than the minimum length', async () => {
      const { status, stderr } = await runHook({ message: 'changes' }) // 7 chars
      expect(status).toBe(1)
      expect(stderr).toContain('too short (7 characters; minimum 8)')
    })

    it('does not let whitespace pad a short message past the minimum', async () => {
      const { status } = await runHook({ message: '  fix  \n\n' }) // 3 content chars
      expect(status).toBe(1)
    })

    it('rejects the "fuck me" style messages', async () => {
      const { status } = await runHook({ message: 'fuck me' }) // too short
      expect(status).toBe(1)
    })

    it('rejects offensive language anywhere in a long-enough message', async () => {
      for (const message of [
        'This is fucking awesome work',
        'SHIT happened in the build',
        'fixed the bitch of a collision bug'
      ]) {
        const { status, stderr } = await runHook({ message })
        expect(status).toBe(1)
        expect(stderr).toContain('offensive language')
      }
    })

    it('rejects single filler phrases that pass the length check', async () => {
      for (const message of [
        'whatever!!!', // normalizes to 'whatever' (8 chars - passes length)
        'In Progress' // normalizes to 'in progress'
      ]) {
        const { status, stderr } = await runHook({ message })
        expect(status).toBe(1)
        expect(stderr).toContain('not a useful commit message')
      }
    })

    it('catches filler phrases case-insensitively and with punctuation', async () => {
      const { status, stderr } = await runHook({ message: 'CHANGES!!!' })
      // 7 content chars - the length check fires first at the default minimum
      expect(status).toBe(1)
      expect(stderr).toContain('too short')

      const raised = await runHook({ message: 'CHANGES!!!', extraEnv: { SVN_MIN_MESSAGE_LENGTH: '3' } })
      expect(raised.status).toBe(1)
      expect(raised.stderr).toContain('not a useful commit message')
    })

    it('honours the SVN_MIN_MESSAGE_LENGTH override', async () => {
      const short = await runHook({ message: 'fix bug', extraEnv: { SVN_MIN_MESSAGE_LENGTH: '8' } }) // 7 chars
      expect(short.status).toBe(1)

      const ok = await runHook({ message: 'fix bug', extraEnv: { SVN_MIN_MESSAGE_LENGTH: '4' } })
      expect(ok.status).toBe(0)
    })

    it('accepts a real descriptive message', async () => {
      const { status } = await runHook({ message: 'Added collision detection to the player controller' })
      expect(status).toBe(0)
    })
  })

  describe('file size check (unchanged behaviour)', () => {
    it('still scans files in an otherwise valid commit', async () => {
      const { status } = await runHook({
        message: 'Added the new level geometry for stage two',
        changed: 'A /trunk/scene.blend\n',
        catForPath: '/trunk/scene.blend',
        catContent: 'smallfile'
      })
      expect(status).toBe(0)
    })

    it('rejects a file over the limit, having skipped deletions and directories first', async () => {
      const big = 'x'.repeat(600) // 600 "bytes" > 500-byte (scaled) limit
      const { status, stderr } = await runHookWithByteLimit({
        message: 'Added the new level geometry for stage two',
        // directories and deletions come first: they must be passed over
        // without tripping the size check before the oversized file is hit
        changed: 'A /trunk/assets\nD /trunk/old.txt\nA /trunk/scene.blend\n',
        catForPath: '/trunk/scene.blend',
        catContent: big
      })
      expect(status).toBe(1)
      expect(stderr).toContain('/trunk/scene.blend')
      expect(stderr).toContain('limit is 500 MB')
    })
  })

  describe('file size allowlist', () => {
    const BIG = 'x'.repeat(600) // 600 "bytes" > 500-byte (scaled) limit

    /** Run the byte-scaled hook in a real repo dir carrying an allowlist. */
    async function runWithAllowlist ({ patterns, changed, catForPath, message = 'Added the new level geometry for stage two' }) {
      const repoDir = path.join(tmpDir, 'repo')
      await mkdir(path.join(repoDir, 'hooks'), { recursive: true })
      await writeFile(path.join(repoDir, 'hooks', 'pre-commit-size-allowlist'), patterns)
      return runHookWithByteLimit({ message, changed, catForPath, catContent: BIG, repoDir })
    }

    it('lets an allowlisted file over the limit through', async () => {
      const { status } = await runWithAllowlist({
        patterns: '*.blend\n',
        changed: 'A /trunk/scene.blend\n',
        catForPath: '/trunk/scene.blend'
      })
      expect(status).toBe(0)
    })

    it('still rejects files that match no pattern', async () => {
      const { status, stderr } = await runWithAllowlist({
        patterns: '*.blend\n',
        changed: 'A /trunk/big.zip\n',
        catForPath: '/trunk/big.zip'
      })
      expect(status).toBe(1)
      expect(stderr).toContain('/trunk/big.zip')
    })

    it('matches directory-scoped patterns against the full repository path', async () => {
      const allowed = await runWithAllowlist({
        patterns: '/trunk/assets/*.zip\n',
        changed: 'A /trunk/assets/level1.zip\n',
        catForPath: '/trunk/assets/level1.zip'
      })
      expect(allowed.status).toBe(0)

      const denied = await runWithAllowlist({
        patterns: '/trunk/assets/*.zip\n',
        changed: 'A /trunk/other/level1.zip\n',
        catForPath: '/trunk/other/level1.zip'
      })
      expect(denied.status).toBe(1)
    })

    it('ignores blank lines and comments in the allowlist', async () => {
      const patterns = '# *.zip\n\n   \n*.blend\n'

      // the commented-out zip pattern must not apply
      const denied = await runWithAllowlist({
        patterns,
        changed: 'A /trunk/a.zip\n',
        catForPath: '/trunk/a.zip'
      })
      expect(denied.status).toBe(1)

      const allowed = await runWithAllowlist({
        patterns,
        changed: 'A /trunk/b.blend\n',
        catForPath: '/trunk/b.blend'
      })
      expect(allowed.status).toBe(0)
    })

    it('tolerates CRLF line endings and surrounding whitespace in the allowlist', async () => {
      const { status } = await runWithAllowlist({
        patterns: '  *.blend  \r\n',
        changed: 'A /trunk/scene.blend\n',
        catForPath: '/trunk/scene.blend'
      })
      expect(status).toBe(0)
    })

    it('keeps enforcing the limit when the allowlist has no active patterns (the default template)', async () => {
      const { status } = await runWithAllowlist({
        // all comments/blank - what every new repository ships with
        patterns: '# nothing allowed yet\n\n',
        changed: 'A /trunk/big.zip\n',
        catForPath: '/trunk/big.zip'
      })
      expect(status).toBe(1)
    })

    it('leaves behaviour unchanged when the allowlist file is absent', async () => {
      const repoDir = path.join(tmpDir, 'repo') // exists, but no hooks/allowlist
      await mkdir(repoDir, { recursive: true })

      const { status } = await runHookWithByteLimit({
        message: 'Added the new level geometry for stage two',
        changed: 'A /trunk/big.zip\n',
        catForPath: '/trunk/big.zip',
        catContent: BIG,
        repoDir
      })
      expect(status).toBe(1)
    })
  })
})
