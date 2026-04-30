import type { Metadata } from "next"

import { isAdminFromCookie } from "@/lib/operator-studio/auth"
import { getActiveDonePhrase } from "@/lib/operator-studio/thread-done"
import {
  getActiveWorkspace,
  listWorkspaces,
} from "@/lib/operator-studio/workspaces"

import { AdminContent } from "./admin-content"
import { AdminDenied } from "./admin-denied"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Admin" }

export default async function AdminPage() {
  const allowed = await isAdminFromCookie()
  if (!allowed) return <AdminDenied />

  const activeWorkspace = await getActiveWorkspace().catch(() => ({
    id: "global",
    label: "Global library",
    isGlobal: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }))
  const workspaces = await listWorkspaces().catch(() => [])

  const donePhrase = getActiveDonePhrase()

  return (
    <AdminContent
      activeWorkspace={activeWorkspace}
      workspaces={workspaces}
      donePhrase={donePhrase}
    />
  )
}
