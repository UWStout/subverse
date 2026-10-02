import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: `file:${process.env.DATABASE_FOLDER ?? './data'}/${process.env.DATABASE_FILE ?? 'accountant.db'}`
  }
})
