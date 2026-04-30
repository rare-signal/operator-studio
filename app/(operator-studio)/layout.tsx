export default function OperatorStudioGroupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative z-10 flex min-h-svh flex-col bg-background">
      {children}
    </div>
  )
}
