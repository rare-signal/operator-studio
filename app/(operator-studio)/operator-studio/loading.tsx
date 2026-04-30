/**
 * Route-group loading fallback. Shown while an individual route's
 * server component is compiling (dev) or fetching data. Because the
 * shell is mounted at the layout level, only the MAIN column gets
 * replaced with this skeleton — the sidebar, brand, workspace
 * switcher, and auth state all persist across navigation.
 *
 * Per-route loading.tsx files (e.g. pulse/loading.tsx) override this
 * with more specific skeletons where we want them.
 */
export default function OperatorStudioLoading() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="h-3 w-24 rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse mb-2" />
      <div className="h-8 w-72 rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse mb-6" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-20 rounded-md bg-stone-200/60 dark:bg-stone-800/60 animate-pulse"
          />
        ))}
      </div>
    </div>
  )
}
