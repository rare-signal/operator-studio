"use client"

import * as React from "react"

/**
 * Wayseer is the LLM-enhancement layer that sits on top of the
 * deterministic Operator Studio core. When Wayseer is *off* (no LLM
 * endpoint configured), every continuation/chat/composer affordance
 * is hidden — the studio still works as a frozen-artifact viewer.
 *
 * The flag mirrors the `llmConfigured` signal already fetched by the
 * shell from `/api/operator-studio/session`. We gate UI on it strictly:
 * if we don't yet know (`null`), we treat Wayseer as off so a fleeting
 * "send" button never appears for a user without an endpoint.
 */
interface WayseerContextValue {
  enabled: boolean
}

const WayseerContext = React.createContext<WayseerContextValue>({
  enabled: false,
})

export function WayseerProvider({
  llmConfigured,
  children,
}: {
  llmConfigured: boolean | null
  children: React.ReactNode
}) {
  const value = React.useMemo(
    () => ({ enabled: llmConfigured === true }),
    [llmConfigured]
  )
  return (
    <WayseerContext.Provider value={value}>{children}</WayseerContext.Provider>
  )
}

export function useWayseer(): WayseerContextValue {
  return React.useContext(WayseerContext)
}
