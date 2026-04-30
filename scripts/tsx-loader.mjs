// Node 22 module-resolution hook: redirects bare `server-only`
// imports to a no-op stub so library code that uses `import
// "server-only"` (e.g. lib/operator-studio/plans.ts) can run inside
// plain Node scripts driven by tsx — the MCP server, the integrity
// checker, the probe scripts, etc.
//
// In production (Next.js), the import goes through the RSC compiler
// which resolves `server-only` to its real implementation that throws
// if you import it from a Client Component module — that protection
// is preserved on the web build path. This shim ONLY affects scripts
// that opt in via `--import ./scripts/tsx-loader.mjs`.

import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STUB_URL = pathToFileURL(path.join(HERE, "server-only-shim.mjs")).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only" || specifier === "client-only") {
    return { url: STUB_URL, format: "module", shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
