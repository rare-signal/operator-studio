import type { Metadata } from "next"

import { isAdminFromCookie } from "@/lib/operator-studio/auth"

import { AdminDenied } from "../admin/admin-denied"
import { ExecutiveInbox } from "./executive-inbox"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Executive recommendations" }

export default async function ExecutivePage() {
  const allowed = await isAdminFromCookie()
  if (!allowed) return <AdminDenied />
  return <ExecutiveInbox />
}
