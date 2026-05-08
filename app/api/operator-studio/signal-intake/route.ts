import { NextResponse } from "next/server"

import { getSignalIntakeSnapshot } from "@/lib/operator-studio/signal-intake"

export async function GET() {
  const snapshot = await getSignalIntakeSnapshot()
  return NextResponse.json(snapshot)
}
