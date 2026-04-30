import { ShieldAlert } from "lucide-react"

export function AdminDenied() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16">
      <div className="rounded-lg border bg-muted/30 p-8 text-center">
        <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h1 className="mb-2 text-xl font-semibold tracking-tight">
          Admin access required
        </h1>
        <p className="mb-6 text-sm text-foreground/80">
          Your current identity isn&apos;t on the admin allowlist. Admins can
          mint API tokens, manage webhook subscriptions, and export
          workspaces.
        </p>
        <div className="mx-auto max-w-xl rounded-md border bg-background p-4 text-left text-xs text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">To grant access:</p>
          <pre className="overflow-x-auto">
            {`# .env.local — add your reviewer name
OPERATOR_STUDIO_ADMINS=alex,sam`}
          </pre>
          <p className="mt-3">
            Leave the variable unset to grant admin to every authenticated
            caller (the self-hosted single-user default). See{" "}
            <code>lib/operator-studio/auth.ts</code> to swap in a real role
            check.
          </p>
        </div>
      </div>
    </div>
  )
}
