#!/usr/bin/env node
/**
 * One-time data migration for the Project entity:
 *   subversion_url / git_url  ->  repository_url / repository_type
 *
 * `prisma db push` drops columns that are no longer in the schema WITHOUT
 * preserving their data, so this script must run BEFORE db push on any
 * database created with the old schema. It is idempotent: a fresh or
 * already-migrated database is left untouched and the script exits quietly.
 *
 * The production entrypoint (docker-entrypoint.sh) runs it automatically
 * before `prisma db push`. For a manual run against an existing volume use:
 *   node scripts/migrate-repository-fields.mjs
 *
 * Mapping rules:
 *   - subversion_url wins over git_url when both are set (this is an
 *     SVN-centric suite; the losing URL is discarded)
 *   - repository_type becomes SUBVERSION or GIT accordingly
 *   - rows with no URL at all keep the schema default (SUBVERSION)
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Same resolution as prisma.config.js (DATABASE_FOLDER / DATABASE_FILE)
const dataDir = process.env.DATABASE_FOLDER ?? path.resolve(__dirname, '../data')
const dbFile = path.join(dataDir, process.env.DATABASE_FILE ?? 'accountant.db')

if (!fs.existsSync(dbFile)) {
  console.log(`No database file at ${dbFile} - nothing to migrate.`)
  process.exit(0)
}

const db = new Database(dbFile)

try {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get()
  if (!table) {
    console.log('No projects table yet - nothing to migrate.')
    process.exit(0)
  }

  const columns = db.prepare('PRAGMA table_info(projects)').all().map(c => c.name)
  const hasSubversion = columns.includes('subversion_url')
  const hasGit = columns.includes('git_url')
  if (!hasSubversion && !hasGit) {
    console.log('Old url columns absent - already migrated, nothing to do.')
    process.exit(0)
  }

  const sources = [hasSubversion && 'subversion_url', hasGit && 'git_url'].filter(Boolean)
  const where = sources.map(s => `${s} IS NOT NULL`).join(' OR ')

  db.transaction(() => {
    db.exec(`
      ALTER TABLE projects ADD COLUMN repository_url TEXT;
      ALTER TABLE projects ADD COLUMN repository_type TEXT NOT NULL DEFAULT 'SUBVERSION';
    `)
    // Every row with a URL gets one (GIT as the provisional value)...
    const info = db.prepare(`
      UPDATE projects
      SET repository_url = COALESCE(${sources.join(', ')}),
          repository_type = ?
      WHERE ${where}
    `).run('GIT')
    // ...and rows with an SVN URL are promoted to SUBVERSION (SVN wins when
    // both URLs are present)
    if (hasSubversion) {
      db.prepare('UPDATE projects SET repository_type = ? WHERE subversion_url IS NOT NULL').run('SUBVERSION')
    }
    console.log(`Migrated ${info.changes} project row(s) to repository_url / repository_type.`)
    if (hasSubversion) db.exec('ALTER TABLE projects DROP COLUMN subversion_url')
    if (hasGit) db.exec('ALTER TABLE projects DROP COLUMN git_url')
  })()

  console.log('Done. `prisma db push` will now find the schema already in place.')
} finally {
  db.close()
}
