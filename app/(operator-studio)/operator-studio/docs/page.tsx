import type { Metadata } from "next"

import { DocsContent } from "./docs-content"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Docs" }

export default function DocsPage() {
  return <DocsContent />
}
