/**
 * MCP server context — workspace resolution and reviewer identity.
 *
 * The web app resolves the active workspace from a cookie, but the
 * MCP server runs as a long-lived stdio process with no HTTP request
 * scope. So the workspace is configured at startup time:
 *
 *   1. `OPERATOR_STUDIO_WORKSPACE` env var, if set
 *   2. CLI arg `--workspace=<id>`
 *   3. Falls back to "global" (the always-present built-in workspace)
 *
 * Tools can also accept a per-call `workspaceId` to switch scope mid-
 * session, but the default keeps single-workspace setups boilerplate-
 * free. The reviewer name (used for plan auto-creation) follows the
 * same fallback: `OPERATOR_STUDIO_REVIEWER` env var → "mcp-agent".
 */

import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"

export interface McpContext {
  /** Default workspace ID. Tools can override per call. */
  defaultWorkspaceId: string
  /** Reviewer name to attribute auto-created plans to. */
  reviewer: string
}

export function buildContextFromEnv(argv: string[] = []): McpContext {
  const workspaceArg = argv
    .find((a) => a.startsWith("--workspace="))
    ?.split("=")[1]
  const reviewerArg = argv
    .find((a) => a.startsWith("--reviewer="))
    ?.split("=")[1]

  return {
    defaultWorkspaceId:
      workspaceArg ??
      process.env.OPERATOR_STUDIO_WORKSPACE ??
      GLOBAL_WORKSPACE_ID,
    reviewer:
      reviewerArg ?? process.env.OPERATOR_STUDIO_REVIEWER ?? "mcp-agent",
  }
}
