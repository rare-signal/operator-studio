import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { schema } from "@/lib/server/db/schema"

const globalForDb = globalThis as typeof globalThis & {
  __operatorStudioPgPool?: Pool
  __operatorStudioDb?: ReturnType<typeof drizzle<typeof schema>>
}

function getDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim()
  if (value) return value
  throw new Error(
    [
      "DATABASE_URL is required for Operator Studio persistence.",
      "",
      "Quick fix:",
      "  cp .env.example .env.local",
      "  # then edit .env.local and point DATABASE_URL at a Postgres you can write to",
      "",
      "If you don't have Postgres yet, see README.md → Quick start.",
    ].join("\n")
  )
}

export function getPgPool() {
  if (!globalForDb.__operatorStudioPgPool) {
    globalForDb.__operatorStudioPgPool = new Pool({
      connectionString: getDatabaseUrl(),
    })
  }
  return globalForDb.__operatorStudioPgPool
}

export function getDb() {
  if (!globalForDb.__operatorStudioDb) {
    globalForDb.__operatorStudioDb = drizzle(getPgPool(), { schema })
  }
  return globalForDb.__operatorStudioDb
}
