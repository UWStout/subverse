import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './prisma/client.js'

// Build absolute paths to the data dir and database file
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dbDirectory = path.resolve(__dirname, '../data')
const dbPath = path.join(dbDirectory, 'accountant.db')
if (!fs.existsSync(dbDirectory)) {
  fs.mkdirSync(dbDirectory, { recursive: true })
}

// Setup prisma-sqlite adapter
console.log(`Opening database file ${dbPath}`)
const sqlite = new Database(dbPath)
const adapter = new PrismaBetterSqlite3({ url: sqlite.name })

// Will hold prisma client reference after initialization
let prisma

/**
 * Initialize the Prisma client and run migrations if needed.
 */
export function initDatabase () {
  prisma = new PrismaClient({ adapter })
  console.log(`Database loaded at ${dbPath}`)
  return prisma
}

/**
 * Get the Prisma client instance (must call initDatabase() first).
 */
export function getDatabase () {
  if (!prisma) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return prisma
}
