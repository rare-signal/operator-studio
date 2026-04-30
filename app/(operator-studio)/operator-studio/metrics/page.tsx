import type { Metadata } from "next"

import { MetricsContent } from "./metrics-content"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Metrics" }

export default function MetricsPage() {
  return <MetricsContent />
}
