/**
 * Cross-platform source-storage path resolution.
 *
 * Every importer locates its session storage through this helper so the
 * Mac/Linux/Windows knowledge lives in one place and we get a consistent
 * env-var override pattern across all sources.
 *
 * The helper handles:
 *   - `~` expansion to the user's home directory
 *   - `$XDG_DATA_HOME`, `$XDG_CONFIG_HOME`, `$XDG_CACHE_HOME` with
 *     XDG-spec fallbacks when unset
 *   - `%APPDATA%`, `%LOCALAPPDATA%`, `%USERPROFILE%` on Windows
 *   - existence filtering (broken / not-yet-created paths drop out)
 *   - env-var override (single env var per source) — wins over platform
 *     defaults, supports `:` (unix) or `;` (Windows) as delimiter
 *
 * Anti-goal: it does not invent paths. Each importer must enumerate its
 * own per-platform defaults — silent guessing produces silent failures.
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

export type Platform = "mac" | "linux" | "windows"

export interface SourceRootSpec {
  /**
   * Env var name that, when set, fully replaces the platform defaults.
   * Multiple paths separated by `:` (unix) or `;` (Windows).
   */
  envVar: string
  /** Per-platform default paths, in priority order. May use `~`, `$XDG_*`, `%APPDATA%` etc. */
  mac: string[]
  linux: string[]
  windows: string[]
}

export function currentPlatform(): Platform {
  if (process.platform === "darwin") return "mac"
  if (process.platform === "win32") return "windows"
  return "linux"
}

/**
 * Resolve all on-disk roots an importer should scan, filtered to ones that
 * actually exist. Order matters: callers walk the result in order, and the
 * first existing match is preferred when sources advertise the same data
 * in multiple locations.
 */
export function resolveSourceRoots(spec: SourceRootSpec): string[] {
  const env = process.env[spec.envVar]
  if (env && env.trim()) {
    const delim = env.includes(path.delimiter)
      ? path.delimiter
      : env.includes(";")
        ? ";"
        : ":"
    return env
      .split(delim)
      .map((p) => p.trim())
      .filter(Boolean)
      .map(expandPath)
      .filter(safeExists)
  }

  const platform = currentPlatform()
  const defaults =
    platform === "mac" ? spec.mac : platform === "windows" ? spec.windows : spec.linux

  return defaults.map(expandPath).filter(safeExists)
}

/**
 * Expand `~`, `$XDG_*`, and `%APPDATA%`-style placeholders. Unknown vars
 * resolve to empty string (which then fails the existence filter), rather
 * than leaving the literal `$FOO` in the path — silent breakage beats
 * misleading "found a session at /Users/me/$XDG_DATA_HOME/foo".
 */
export function expandPath(p: string): string {
  let out = p
  if (out.startsWith("~")) {
    out = path.join(os.homedir(), out.slice(1))
  }
  // Windows-style %VAR%
  out = out.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_, name) => {
    return process.env[name] ?? winFallback(name) ?? ""
  })
  // Unix-style $VAR / ${VAR}
  out = out.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, name) => {
    return process.env[name] ?? xdgFallback(name) ?? ""
  })
  return out
}

/**
 * XDG Base Directory Spec defaults. Lets a path like `$XDG_DATA_HOME/opencode`
 * resolve correctly on a Linux box that hasn't set XDG vars (the common case).
 */
function xdgFallback(name: string): string | null {
  const home = os.homedir()
  switch (name) {
    case "XDG_DATA_HOME":
      return path.join(home, ".local", "share")
    case "XDG_CONFIG_HOME":
      return path.join(home, ".config")
    case "XDG_CACHE_HOME":
      return path.join(home, ".cache")
    case "XDG_STATE_HOME":
      return path.join(home, ".local", "state")
    case "HOME":
      return home
    default:
      return null
  }
}

function winFallback(name: string): string | null {
  // When running the dev server on Mac/Linux against a Windows path spec
  // (e.g. for testing), provide reasonable approximations so paths don't
  // explode. In production-on-Windows these env vars are always set.
  const home = os.homedir()
  switch (name.toUpperCase()) {
    case "USERPROFILE":
      return home
    case "APPDATA":
      return path.join(home, "AppData", "Roaming")
    case "LOCALAPPDATA":
      return path.join(home, "AppData", "Local")
    default:
      return null
  }
}

function safeExists(p: string): boolean {
  if (!p) return false
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}
