import type { Metadata } from "next"

import { ActivityFeed } from "./activity-feed"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Activity Log" }

export default function ActivityPage() {
  return <ActivityFeed />
}
