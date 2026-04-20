"use client"

import * as React from "react"
import { User, Check } from "lucide-react"

import { Button } from "@/registry/new-york-v4/ui/button"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
const QUICK_PICKS = ["Operator 1", "Operator 2", "Operator 3", "Operator 4"]

export function IdentityModal({
  onComplete,
}: {
  onComplete: (name: string) => void
}) {
  const [name, setName] = React.useState("")
  const [confirmed, setConfirmed] = React.useState(false)

  const handleQuickPick = (picked: string) => {
    setName(picked)
  }

  const handleConfirm = () => {
    if (!name.trim()) return
    if (!confirmed) {
      setConfirmed(true)
      return
    }
    onComplete(name.trim())
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="mx-auto w-full max-w-sm space-y-8 px-4">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <User className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              Who are you?
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your name will appear on imports and promoted threads.
            </p>
          </div>
        </div>

        {!confirmed ? (
          <div className="space-y-4">
            <div className="flex flex-wrap justify-center gap-2">
              {QUICK_PICKS.map((pick) => (
                <button
                  key={pick}
                  type="button"
                  onClick={() => handleQuickPick(pick)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    name === pick
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {pick}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="os-name" className="text-xs text-muted-foreground">
                Or type your name
              </Label>
              <Input
                id="os-name"
                type="text"
                placeholder="Your first name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <Button
              onClick={handleConfirm}
              className="w-full"
              disabled={!name.trim()}
            >
              Continue
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/50 p-4 text-center">
              <p className="text-sm text-muted-foreground">
                You'll be operating as
              </p>
              <p className="mt-1 text-lg font-semibold">{name}</p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmed(false)}
                className="flex-1"
              >
                Go Back
              </Button>
              <Button onClick={handleConfirm} className="flex-1">
                <Check className="mr-2 h-4 w-4" />
                Confirm
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
