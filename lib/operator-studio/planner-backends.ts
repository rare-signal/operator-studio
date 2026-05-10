import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { delimiter, join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type PlannerBackendKind =
  | "codex"
  | "claude-cli"
  | "claude-desktop"
  | "codex-app"
  | "desktop-automation-host"
  | "hermes"
  | "lm-studio"
  | "ollama"
  | "tmux"

export type PlannerBackendRole = "planner" | "worker-launcher" | "both"

export interface PlannerBackendStatus {
  kind: PlannerBackendKind
  role: PlannerBackendRole
  available: boolean
  label: string
  detail: string
  command?: string | null
  endpoint?: string | null
  models?: string[]
  nextAction?: string | null
}

export type PlannerBrainKind = "claude" | "codex" | "hermes" | "lm-studio" | "ollama"
export type WorkerLauncherKind =
  | "claude-desktop"
  | "claude-cli"
  | "codex-app"
  | "codex-cli"
  | "tmux"
  | "lm-studio"
  | "ollama"

export interface BackendCapability {
  kind: PlannerBrainKind | WorkerLauncherKind
  available: boolean
  label: string
  detail: string
  backendKinds: PlannerBackendKind[]
  nextAction?: string | null
}

export interface BackendInventory {
  plannerBrains: BackendCapability[]
  workerLaunchers: BackendCapability[]
}

export interface PlannerBackendReport {
  generatedAt: string
  doctrine: string
  backends: PlannerBackendStatus[]
  inventory: BackendInventory
}

async function executableOnPath(name: string): Promise<string | null> {
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  for (const dir of paths) {
    const candidate = join(dir, name)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // keep looking
    }
  }
  return null
}

async function commandVersion(command: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync(command, args, { timeout: 1500 })
    return (result.stdout || result.stderr).trim().split(/\r?\n/)[0] ?? null
  } catch {
    return null
  }
}

async function fetchModels(url: string): Promise<string[] | null> {
  const signal = AbortSignal.timeout(1200)
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const json = (await res.json()) as unknown
    if (
      json &&
      typeof json === "object" &&
      Array.isArray((json as { data?: unknown }).data)
    ) {
      return (json as { data: Array<{ id?: unknown }> }).data
        .map((m) => (typeof m.id === "string" ? m.id : null))
        .filter((m): m is string => !!m)
    }
    if (
      json &&
      typeof json === "object" &&
      Array.isArray((json as { models?: unknown }).models)
    ) {
      return (json as { models: Array<{ name?: unknown }> }).models
        .map((m) => (typeof m.name === "string" ? m.name : null))
        .filter((m): m is string => !!m)
    }
  } catch {
    return null
  }
  return null
}

interface ProcessInfo {
  pid: number
  ppid: number
  command: string
  args: string
}

async function inspectProcess(pid: number): Promise<ProcessInfo | null> {
  try {
    const result = await execFileAsync(
      "ps",
      ["-p", String(pid), "-o", "pid=", "-o", "ppid=", "-o", "comm=", "-o", "args="],
      { timeout: 1000 },
    )
    const line = result.stdout.trim()
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/)
    if (!match) return null
    return {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3] ?? "",
      args: match[4]?.trim() ?? "",
    }
  } catch {
    return null
  }
}

async function findPortListener(port: number): Promise<number | null> {
  try {
    const result = await execFileAsync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"],
      { timeout: 1000 },
    )
    const line = result.stdout
      .split(/\r?\n/)
      .find((candidate) => /\bLISTEN\b/.test(candidate) && /\bnode\b|\bnext-server\b/.test(candidate))
    if (!line) return null
    const parts = line.trim().split(/\s+/)
    const pid = Number(parts[1])
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

async function inspectProcessChain(startPid: number): Promise<ProcessInfo[]> {
  const chain: ProcessInfo[] = []
  const seen = new Set<number>()
  let pid = startPid

  while (pid > 1 && !seen.has(pid) && chain.length < 8) {
    seen.add(pid)
    const info = await inspectProcess(pid)
    if (!info) break
    chain.push(info)
    pid = info.ppid
  }

  return chain
}

async function inspectDesktopAutomationHost(): Promise<PlannerBackendStatus> {
  const port = Number(process.env.PORT || "4200")
  const pid = await findPortListener(port)
  if (!pid) {
    return {
      kind: "desktop-automation-host",
      role: "worker-launcher",
      available: false,
      label: "Desktop automation host",
      detail: `No Next dev server listener was found on port ${port}; Operator Studio desktop launches cannot be attributed to a host process.`,
      nextAction:
        "Start Operator Studio from the app or shell that is expected to own macOS Accessibility permission, then rerun pnpm os:planners.",
    }
  }

  const chain = await inspectProcessChain(pid)
  const chainText = chain
    .map((p) => `${p.pid}:${p.command}${p.args ? ` ${p.args}` : ""}`)
    .join(" <- ")
  const host = chain.find((p) => p.args.includes(".app/Contents/")) ?? chain.at(-1)
  const hostText = host ? `${host.command} ${host.args}`.trim() : "unknown"
  const hostedByClaude = chain.some((p) => p.args.includes("/Applications/Claude.app/"))

  return {
    kind: "desktop-automation-host",
    role: "worker-launcher",
    available: true,
    label: "Desktop automation host",
    detail: hostedByClaude
      ? `Operator Studio is currently served from a process chain rooted in Claude.app (${hostText}). This can focus Claude while still failing System Events keystrokes if that host lacks Accessibility permission. Chain: ${chainText}`
      : `Operator Studio dev server listener on port ${port} is PID ${pid}. Chain: ${chainText}`,
    nextAction: hostedByClaude
      ? "If Claude launches used to work end-to-end, compare the prior host. Restart pnpm dev from the Accessibility-approved shell/app, or grant Accessibility to the current Claude-hosted automation process, then retry the Claude launch battle test."
      : null,
  }
}

function buildBackendInventory(backends: PlannerBackendStatus[]): BackendInventory {
  const byKind = new Map(backends.map((backend) => [backend.kind, backend]))
  const backend = (kind: PlannerBackendKind) => byKind.get(kind)

  const claudeCli = backend("claude-cli")
  const claudeDesktop = backend("claude-desktop")
  const codexCli = backend("codex")
  const codexApp = backend("codex-app")
  const hermes = backend("hermes")
  const lmStudio = backend("lm-studio")
  const ollama = backend("ollama")
  const tmux = backend("tmux")
  const desktopHost = backend("desktop-automation-host")

  return {
    plannerBrains: [
      {
        kind: "claude",
        available: !!claudeCli?.available || !!claudeDesktop?.available,
        label: "Claude planner brain",
        detail: claudeCli?.available
          ? "Claude CLI is present and can act as a planner brain; Claude Desktop remains the current interactive worker surface."
          : "Claude Desktop is available as an interactive worker surface, but Claude CLI planner use is optional/future unless explicitly selected.",
        backendKinds: ["claude-cli", "claude-desktop"],
        nextAction: claudeCli?.available
          ? null
          : "Keep Claude planning routed through explicit desktop/Operator Studio handoff until a headless Claude planner is selected.",
      },
      {
        kind: "codex",
        available: !!codexCli?.available || !!codexApp?.available,
        label: "Codex planner brain",
        detail: codexCli?.available
          ? "Codex CLI is present for headless planner checks."
          : codexApp?.available
            ? "Codex app is hosting this session, but Codex CLI was not found on this PATH."
            : "Codex is not available as a detected planner backend from this process.",
        backendKinds: ["codex", "codex-app"],
        nextAction: codexCli?.available
          ? null
          : "Use the current Codex app session manually, or expose codex CLI on PATH before selecting Codex as a headless planner.",
      },
      {
        kind: "hermes",
        available: !!hermes?.available,
        label: "Hermes planner brain",
        detail: hermes?.detail ?? "Hermes has not been probed.",
        backendKinds: ["hermes"],
        nextAction: hermes?.nextAction ?? null,
      },
      {
        kind: "lm-studio",
        available: !!lmStudio?.available,
        label: "LM Studio planner brain",
        detail: lmStudio?.detail ?? "LM Studio has not been probed.",
        backendKinds: ["lm-studio"],
        nextAction: lmStudio?.nextAction ?? null,
      },
      {
        kind: "ollama",
        available: !!ollama?.available,
        label: "Ollama planner brain",
        detail: ollama?.detail ?? "Ollama has not been probed.",
        backendKinds: ["ollama"],
        nextAction: ollama?.nextAction ?? null,
      },
    ],
    workerLaunchers: [
      {
        kind: "claude-desktop",
        available: !!claudeDesktop?.available && !!desktopHost?.available,
        label: "Claude Desktop launcher",
        detail: desktopHost?.detail ?? claudeDesktop?.detail ?? "Claude Desktop launcher has not been probed.",
        backendKinds: ["claude-desktop", "desktop-automation-host"],
        nextAction: desktopHost?.nextAction ?? claudeDesktop?.nextAction ?? null,
      },
      {
        kind: "claude-cli",
        available: !!claudeCli?.available && !!tmux?.available,
        label: "Claude CLI / tmux launcher",
        detail: claudeCli?.available
          ? "Claude CLI is present; tmux availability determines whether it can be launched as a managed worker lane."
          : claudeCli?.detail ?? "Claude CLI has not been probed.",
        backendKinds: ["claude-cli", "tmux"],
        nextAction:
          claudeCli?.available && tmux?.available
            ? null
            : "Treat Claude CLI/tmux as optional future plumbing until both pieces are available and selected.",
      },
      {
        kind: "codex-app",
        available: !!codexApp?.available,
        label: "Codex app launcher",
        detail: codexApp?.detail ?? "Codex app has not been probed.",
        backendKinds: ["codex-app"],
        nextAction: codexApp?.nextAction ?? null,
      },
      {
        kind: "codex-cli",
        available: !!codexCli?.available && !!tmux?.available,
        label: "Codex CLI / tmux launcher",
        detail: codexCli?.available
          ? "Codex CLI is present; tmux availability determines whether it can be launched as a managed worker lane."
          : codexCli?.detail ?? "Codex CLI has not been probed.",
        backendKinds: ["codex", "tmux"],
        nextAction:
          codexCli?.available && tmux?.available
            ? null
            : "Use Codex app/session manually, or expose codex CLI and tmux before selecting a headless Codex worker launcher.",
      },
      {
        kind: "tmux",
        available: !!tmux?.available,
        label: "tmux generic launcher",
        detail: tmux?.detail ?? "tmux has not been probed.",
        backendKinds: ["tmux"],
        nextAction: tmux?.nextAction ?? null,
      },
      {
        kind: "lm-studio",
        available: !!lmStudio?.available,
        label: "LM Studio local endpoint launcher",
        detail: lmStudio?.detail ?? "LM Studio has not been probed.",
        backendKinds: ["lm-studio"],
        nextAction: lmStudio?.nextAction ?? null,
      },
      {
        kind: "ollama",
        available: !!ollama?.available,
        label: "Ollama local endpoint launcher",
        detail: ollama?.detail ?? "Ollama has not been probed.",
        backendKinds: ["ollama"],
        nextAction: ollama?.nextAction ?? null,
      },
    ],
  }
}

export async function inspectPlannerBackends(): Promise<PlannerBackendReport> {
  const claudePath = await executableOnPath("claude")
  const codexPath = await executableOnPath("codex")
  const tmuxPath = await executableOnPath("tmux")
  const hermesPath = await executableOnPath("hermes")
  const lmStudioEndpoint =
    process.env.LM_STUDIO_BASE_URL?.trim() || "http://127.0.0.1:1234/v1/models"
  const ollamaEndpoint =
    process.env.OLLAMA_TAGS_URL?.trim() || "http://127.0.0.1:11434/api/tags"
  const [lmStudioModels, ollamaModels, desktopAutomationHost] = await Promise.all([
    fetchModels(lmStudioEndpoint),
    fetchModels(ollamaEndpoint),
    inspectDesktopAutomationHost(),
  ])

  const backends: PlannerBackendStatus[] = [
    {
      kind: "codex-app",
      role: "both",
      available: true,
      label: "Codex app session",
      detail:
        "This Codex app session is available as the current interactive planner surface; it is not the same as codex CLI on PATH.",
      nextAction:
        "Use explicit Operator Studio records when handing work to another backend; do not silently substitute Codex app subagents for requested Claude/Hermes/LM Studio work.",
    },
    {
      kind: "codex",
      role: "planner",
      available: !!codexPath,
      label: "Codex CLI",
      command: codexPath,
      detail: codexPath
        ? `codex found at ${codexPath}`
        : "codex CLI was not found on PATH for a headless planner run.",
      nextAction: codexPath
        ? null
        : "Use the current Codex session manually, or install/configure codex CLI before selecting it as a backend.",
    },
    {
      kind: "claude-cli",
      role: "both",
      available: !!claudePath,
      label: "Claude CLI (optional/future)",
      command: claudePath,
      detail: claudePath
        ? `claude found at ${claudePath}`
        : "Claude CLI is not part of the current primary workflow and was not found on PATH. Current Claude work should route through Claude Desktop / Operator Studio surfaces unless the operator explicitly installs/configures a CLI path later.",
      nextAction: claudePath
        ? null
        : "Use the Claude Desktop launcher/fallback surfaces for Claude lanes today; treat CLI/tmux Claude as an optional future backend, not a prerequisite.",
    },
    {
      kind: "tmux",
      role: "worker-launcher",
      available: !!tmuxPath,
      label: "tmux worker host",
      command: tmuxPath,
      detail: tmuxPath
        ? (await commandVersion(tmuxPath, ["-V"])) ?? `tmux found at ${tmuxPath}`
        : "tmux was not found on PATH.",
      nextAction: tmuxPath ? null : "Install tmux before using headless worker sessions.",
    },
    {
      kind: "hermes",
      role: "planner",
      available: !!hermesPath,
      label: "Hermes local router",
      command: hermesPath,
      detail: hermesPath
        ? `hermes found at ${hermesPath}`
        : "hermes executable was not found on PATH.",
      nextAction: hermesPath
        ? null
        : "Define the Hermes invocation command or route Hermes through the LM Studio/OpenAI-compatible backend.",
    },
    {
      kind: "lm-studio",
      role: "planner",
      available: !!lmStudioModels,
      label: "LM Studio OpenAI-compatible endpoint",
      endpoint: lmStudioEndpoint,
      models: lmStudioModels ?? [],
      detail: lmStudioModels
        ? `LM Studio endpoint responded with ${lmStudioModels.length} model(s).`
        : `No LM Studio response at ${lmStudioEndpoint}.`,
      nextAction: lmStudioModels
        ? null
        : "Start LM Studio local server or set LM_STUDIO_BASE_URL to the models endpoint.",
    },
    {
      kind: "ollama",
      role: "planner",
      available: !!ollamaModels,
      label: "Ollama local endpoint",
      endpoint: ollamaEndpoint,
      models: ollamaModels ?? [],
      detail: ollamaModels
        ? `Ollama endpoint responded with ${ollamaModels.length} model(s).`
        : `No Ollama response at ${ollamaEndpoint}.`,
      nextAction: ollamaModels
        ? null
        : "Start Ollama or set OLLAMA_TAGS_URL if using a different local router.",
    },
    {
      kind: "claude-desktop",
      role: "worker-launcher",
      available: true,
      label: "Claude Desktop hot-mode launcher",
      detail:
        "Desktop launch is available only through Operator Studio hot-mode/accessibility gates; this preflight cannot prove it is armed.",
      nextAction:
        "Use /agents/new-session or Bento with hot mode armed; if it fails, recover via launch-attempt fallback.",
    },
    desktopAutomationHost,
  ]

  return {
    generatedAt: new Date().toISOString(),
    doctrine:
      "Berthier must distinguish planner brain from worker launcher. Current Claude work routes through Claude Desktop / Operator Studio surfaces; Hermes or LM Studio can become planner-router backends. Do not silently replace requested Claude/Hermes/LM Studio work with Codex subagents.",
    backends,
    inventory: buildBackendInventory(backends),
  }
}

export function renderPlannerBackendReport(report: PlannerBackendReport): string {
  const lines: string[] = []
  lines.push(`# Berthier Planner Backend Preflight — ${report.generatedAt}`)
  lines.push(report.doctrine)
  lines.push("")
  lines.push("## Planner Brains")
  for (const brain of report.inventory.plannerBrains) {
    const mark = brain.available ? "ok" : "missing"
    lines.push(`- [${mark}] ${brain.label} (${brain.kind})`)
    lines.push(`  ${brain.detail}`)
    if (brain.nextAction) lines.push(`  next: ${brain.nextAction}`)
  }
  lines.push("")
  lines.push("## Worker Launchers")
  for (const launcher of report.inventory.workerLaunchers) {
    const mark = launcher.available ? "ok" : "missing"
    lines.push(`- [${mark}] ${launcher.label} (${launcher.kind})`)
    lines.push(`  ${launcher.detail}`)
    if (launcher.nextAction) lines.push(`  next: ${launcher.nextAction}`)
  }
  lines.push("")
  lines.push("## Raw Probes")
  for (const backend of report.backends) {
    const mark = backend.available ? "ok" : "missing"
    lines.push(`- [${mark}] ${backend.label} (${backend.kind}, ${backend.role})`)
    lines.push(`  ${backend.detail}`)
    if (backend.models && backend.models.length > 0) {
      lines.push(`  models: ${backend.models.slice(0, 8).join(", ")}`)
    }
    if (backend.nextAction) lines.push(`  next: ${backend.nextAction}`)
  }
  return lines.join("\n")
}
