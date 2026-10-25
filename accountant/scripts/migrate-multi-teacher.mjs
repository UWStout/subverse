#!/usr/bin/env node
/**
 * One-time data migration for co-taught offerings:
 *   offerings.teacher_id (single FK)  ->  _TeacherOfferings join table
 *
 * The schema now models offering teachers as an implicit many-to-many
 * relation. `prisma db push` drops columns that are no longer in the schema
 * WITHOUT preserving their data, so this script must run BEFORE db push on
 * any database created with the old schema. It is idempotent: a fresh or
 * already-migrated database is left untouched and the script exits quietly.
 *
 * The production entrypoint (docker-entrypoint.sh) runs it automatically
 * before `prisma db push`. For a manual run against an existing volume use:
 *   node scripts/migrate-multi-teacher.mjs
 *
 * SQLite cannot DROP COLUMN a column that appears in a foreign key
 * constraint, so the offerings table is rebuilt (create / copy / drop /
 * rename) instead. All DDL below replicates exactly what Prisma 7 generates
 * for this schema (verified against a scratch database): join table
 * `_TeacherOfferings` with column A -> offerings.id, B -> users.id, cascade
 * deletes on both sides, plus the AB unique index and the B index.
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
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'offerings'").get()
  if (!table) {
    console.log('No offerings table yet - nothing to migrate.')
    process.exit(0)
  }

  const columns = db.prepare('PRAGMA table_info(offerings)').all().map(c => c.name)
  if (!columns.includes('teacher_id')) {
    console.log('offerings.teacher_id absent - already migrated, nothing to do.')
    process.exit(0)
  }

  // Refuse to run against an unexpected shape rather than risk dropping data.
  const expected = new Set(['id', 'class_id', 'teacher_id', 'term', 'section'])
  for (const col of columns) {
    if (!expected.has(col)) {
      throw new Error(`Unexpected column in offerings table: '${col}' - refusing to migrate.`)
    }
  }

  db.transaction(() => {
    // Remember the old single-teacher assignments before the surgery.
    const pairs = db.prepare('SELECT id, teacher_id FROM offerings WHERE teacher_id IS NOT NULL').all()

    // Rebuild offerings without teacher_id (its FK blocks a plain DROP COLUMN).
    db.exec('DROP INDEX IF EXISTS "offerings_teacher_id_key"')
    db.exec(`
      CREATE TABLE "offerings_new" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "class_id" INTEGER NOT NULL,
        "term" TEXT,
        "section" TEXT,
        CONSTRAINT "offerings_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `)
    db.exec('INSERT INTO "offerings_new" ("id", "class_id", "term", "section") SELECT id, class_id, term, section FROM "offerings"')
    db.exec('DROP TABLE "offerings"')
    db.exec('ALTER TABLE "offerings_new" RENAME TO "offerings"')

    // Recreate the indexes Prisma expects on the rebuilt table.
    db.exec('CREATE UNIQUE INDEX "offerings_class_id_term_section_key" ON "offerings"("class_id", "term", "section")')
    db.exec('CREATE INDEX "offerings_class_id_key" ON "offerings"("class_id")')

    // Keep AUTOINCREMENT numbering past the copied rows.
    db.exec(`UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM offerings) WHERE name = 'offerings'`)

    // Create the join table exactly as Prisma would, then re-insert the
    // remembered teacher assignments.
    db.exec(`
      CREATE TABLE "_TeacherOfferings" (
        "A" INTEGER NOT NULL,
        "B" INTEGER NOT NULL,
        CONSTRAINT "_TeacherOfferings_A_fkey" FOREIGN KEY ("A") REFERENCES "offerings" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "_TeacherOfferings_B_fkey" FOREIGN KEY ("B") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `)
    db.exec('CREATE UNIQUE INDEX "_TeacherOfferings_AB_unique" ON "_TeacherOfferings"("A", "B")')
    db.exec('CREATE INDEX "_TeacherOfferings_B_index" ON "_TeacherOfferings"("B")')

    const insert = db.prepare('INSERT OR IGNORE INTO "_TeacherOfferings" ("A", "B") VALUES (?, ?)')
    for (const { id, teacher_id } of pairs) insert.run(id, teacher_id)
    console.log(`Migrated ${pairs.length} offering row(s) to the _TeacherOfferings join table.`)
  })()

  console.log('Done. `prisma db push` will now find the schema already in place.')
} finally {
  db.close()
}
