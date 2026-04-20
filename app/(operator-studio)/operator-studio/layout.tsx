import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Operator Studio",
  description:
    "Review, summarize, and continue agent coding sessions.",
  robots: { index: false, follow: false },
}

export default function OperatorStudioLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
