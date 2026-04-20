import type { Metadata, Viewport } from "next"
import { ThemeProvider } from "next-themes"

import "@/styles/globals.css"

export const metadata: Metadata = {
  title: "Operator Studio",
  description:
    "Review, summarize, and continue agent coding sessions. Import threads from Claude Code or Codex, promote the good parts, and keep chatting — grounded in your own history.",
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-svh font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
