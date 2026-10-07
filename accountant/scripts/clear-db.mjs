/**
 * clear-db.mjs - Remove ALL data from the accountant database.
 *
 * Usage:
 *   npm run db:clear
 *
 * Deletes every row in assignments, projects, offerings, classes and users
 * (in foreign-key order) inside a single transaction, then resets the SQLite
 * autoincrement counters so freshly seeded or created records start at id 1
 * again. The schema itself is left intact - only the data goes away.
 */

import { initDatabase } from '../server/db.js'

const db = initDatabase()

/** Table name -> model used for counting (actual SQLite table names). */
const TABLES = ['assignments', 'projects', 'offerings', 'classes', 'users']

const before = {}
try {
  for (const table of TABLES) {
    const rows = await db.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM "${table}"`)
    before[table] = Number(rows[0].c)
  }
} catch (err) {
  console.error(`Could not read the database: ${err.message}`)
  console.error('Make sure the schema has been applied first (npm run db:push).')
  process.exit(1)
}

if (Object.values(before).every(c => c === 0)) {
  console.log('Database is already empty - nothing to clear.')
  process.exit(0)
}

try {
  await db.$transaction(async tx => {
    // Delete in foreign-key order: children first.
    await tx.assignment.deleteMany()
    await tx.project.deleteMany()
    await tx.offering.deleteMany()
    await tx.class.deleteMany()
    await tx.user.deleteMany()
    // Reset autoincrement sequences so new ids start at 1 again.
    await tx.$executeRawUnsafe(
      'DELETE FROM sqlite_sequence WHERE name IN (\'users\', \'classes\', \'offerings\', \'projects\')'
    )
  })
} catch (err) {
  console.error('Clearing failed, database left unchanged:', err.message)
  process.exit(1)
}

console.log('Cleared all data from the accountant database:')
for (const table of TABLES) {
  console.log(`  ${table.padEnd(12)} ${before[table]} row(s) deleted`)
}
console.log('The schema is intact; the database is empty again.')

process.exit(0)
