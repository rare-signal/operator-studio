import { config as loadEnv } from "dotenv"
import type { Config } from "drizzle-kit"

// Load .env.local first, falling back to .env. Matches Next.js behavior so
// `pnpm db:*` commands see the same DATABASE_URL as `pnpm dev`.
loadEnv({ path: ".env.local" })
loadEnv({ path: ".env" })

export default {
  schema: "./lib/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      "postgres://postgres:postgres@localhost:5432/operator_studio",
  },
} satisfies Config
