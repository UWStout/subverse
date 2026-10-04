/**
 * audit-prod.mjs - npm audit, scoped to what the production image actually ships.
 *
 * Why this exists:
 *   Plain `npm audit` audits the full ideal tree from package-lock.json. That
 *   tree includes devDependencies AND peer edges that were resolved into the
 *   lockfile. In this project @prisma/client declares the prisma CLI as an
 *   *optional* peer dependency, so the CLI - and its mysql2 / @prisma/config /
 *   deepmerge-ts subtree - shows up in every audit run, even though the
 *   Dockerfile production stage installs with `npm ci --omit=dev
 *   --legacy-peer-deps` and never receives it. npm has no built-in way to
 *   ignore dev-only findings (and `--omit=dev` / `--omit=peer` do not help,
 *   because the lockfile materializes the peer edge).
 *
 * What this does:
 *   1. Recomputes the shipped set directly from package.json +
 *      package-lock.json: start from production dependencies and follow only
 *      hard `dependencies` / `optionalDependencies` edges - exactly what
 *      `npm ci --omit=dev --legacy-peer-deps` materializes (no peer
 *      auto-install).
 *   2. Runs the real `npm audit --json` against the full tree.
 *   3. Filters findings: a finding counts only if its package ships.
 *
 * IMPORTANT: if the Dockerfile production-stage install command changes, this
 * script's model of "what ships" must change with it.
 *
 * Exit codes: 0 = no prod-relevant vulnerabilities, 1 = found, 2 = error.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const here = new URL('.', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('../package.json', here), 'utf8'))
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', here), 'utf8'))

// --- 1. Compute the shipped set (model of `npm ci --omit=dev --legacy-peer-deps`) ---

/** Resolve a dependency name from a lockfile path, walking up to the root. */
function resolveDep (fromPath, name) {
  let prefix = fromPath
  for (;;) {
    const candidate = prefix ? `${prefix}/node_modules/${name}` : `node_modules/${name}`
    if (lock.packages[candidate]) return candidate
    if (!prefix) return null
    const idx = prefix.lastIndexOf('/')
    prefix = idx === -1 ? '' : prefix.slice(0, idx)
  }
}

/**
 * Would npm install this entry on the current machine? The lockfile records
 * every platform variant of optional deps (e.g. all @esbuild/* binaries,
 * fsevents); npm only materializes the one matching os/cpu.
 */
function installsHere (entry) {
  for (const [field, value] of [['os', process.platform], ['cpu', process.arch]]) {
    const list = entry[field]
    if (!Array.isArray(list)) continue
    const excluded = list.filter((v) => v.startsWith('!')).map((v) => v.slice(1))
    const included = list.filter((v) => !v.startsWith('!'))
    if (excluded.includes(value)) return false
    if (included.length > 0 && !included.includes(value)) return false
  }
  return true
}

const shipped = new Set() // lockfile paths that end up in the production image
const queue = Object.keys(pkg.dependencies ?? {})
  .map((dep) => resolveDep('', dep))
  .filter(Boolean)

while (queue.length > 0) {
  const path = queue.shift()
  if (shipped.has(path)) continue
  const entry = lock.packages[path]
  if (!installsHere(entry)) continue // platform-gated optional: npm skips it here
  shipped.add(path)
  const deps = { ...entry.dependencies, ...entry.optionalDependencies }
  for (const name of Object.keys(deps ?? {})) {
    const child = resolveDep(path, name)
    if (child && !shipped.has(child)) queue.push(child)
  }
}

// A package NAME "ships" if any instance of it is in the shipped set.
const shipsByName = new Set()
for (const path of shipped) shipsByName.add(path.replace(/^node_modules\//, ''))

// --- 2. Run the real audit against the full tree ---
// (fixed arguments only; shell:true so Windows resolves npm.cmd)

const res = spawnSync('npm audit --json', { encoding: 'utf8', shell: true })
let report
try {
  report = JSON.parse(res.stdout)
} catch {
  console.error('Failed to parse npm audit output:', res.stdout, res.stderr)
  process.exit(2)
}

// --- 3. Filter findings to the shipped set ---

const prodFindings = []
const devOnlyFindings = []
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (shipsByName.has(name)) prodFindings.push({ name, severity: vuln.severity })
  else devOnlyFindings.push({ name, severity: vuln.severity })
}

console.log(`Production tree: ${shipped.size} packages (per package.json + lockfile)`)

if (prodFindings.length > 0) {
  console.error('\nvulnerabilities in the PRODUCTION dependency tree:')
  for (const f of prodFindings) console.error(`  ${f.severity}  ${f.name}`)
  if (devOnlyFindings.length > 0) {
    console.log(`\n(${devOnlyFindings.length} dev-only finding(s) ignored - run 'npm audit' for the full report)`)
  }
  process.exit(1)
}

if (devOnlyFindings.length > 0) {
  console.log('OK: no production vulnerabilities.')
  console.log(`Ignored ${devOnlyFindings.length} dev-only finding(s):`)
  for (const f of devOnlyFindings) console.log(`  [dev] ${f.severity}  ${f.name}`)
} else {
  console.log('OK: no vulnerabilities at all.')
}
