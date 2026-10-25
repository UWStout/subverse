// One-off helper (not part of the app): create a scratch SQLite database with
// the exact current schema shape so scripts can be exercised end-to-end
// without `prisma db push` (which prompts for consent in agent contexts).
// Usage: node scripts/scratch-db.mjs <db-file>
import Database from 'better-sqlite3'
import { rmSync } from 'node:fs'

const target = process.argv[2]
if (!target) {
  console.error('Usage: node scripts/scratch-db.mjs <db-file>')
  process.exit(1)
}
rmSync(target, { force: true })
const db = new Database(target)
db.pragma('foreign_keys = ON')
db.exec(`
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'STUDENT',
  verification_token TEXT,
  verification_sent_at DATETIME,
  reset_token TEXT,
  reset_sent_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX users_username_key ON users(username);
CREATE UNIQUE INDEX users_email_key ON users(email);
CREATE INDEX users_username_idx ON users(username);
CREATE INDEX users_email_idx ON users(email);

CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  number TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX classes_subject_number_key ON classes(subject, number);
CREATE INDEX classes_subject_idx ON classes(subject);

CREATE TABLE offerings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  term TEXT NOT NULL,
  section TEXT NOT NULL,
  FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX offerings_class_id_term_section_key ON offerings(class_id, term, section);
CREATE INDEX offerings_class_id_idx ON offerings(class_id);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'OTHER',
  repository_url TEXT,
  repository_type TEXT NOT NULL DEFAULT 'SUBVERSION',
  description TEXT,
  FOREIGN KEY(offering_id) REFERENCES offerings(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX projects_slug_key ON projects(slug);
CREATE INDEX projects_offering_id_idx ON projects(offering_id);

CREATE TABLE assignments (
  student_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  PRIMARY KEY(student_id, project_id),
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE _TeacherOfferings (
  A INTEGER NOT NULL,
  B INTEGER NOT NULL,
  FOREIGN KEY(A) REFERENCES offerings(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY(B) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX _TeacherOfferings_AB_unique ON _TeacherOfferings(A, B);
CREATE INDEX _TeacherOfferings_B_index ON _TeacherOfferings(B);
`)
db.close()
console.log(`Scratch database created at ${target}`)
