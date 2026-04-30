/**
 * Pulse skeleton — shown while the graph loader is running. Mirrors
 * the real view's column structure so the layout doesn't jump when
 * content streams in: header strip, ruler, then N row placeholders
 * with title + sparkline + meta columns.
 */
export function PulseSkeleton() {
  return (
    <div className="mx-auto max-w-[1440px] px-6 lg:px-10 py-10">
      {/* Top strip */}
      <div className="flex items-center gap-3 mb-2">
        <Bar w={14} h={14} rounded="full" />
        <Bar w={50} h={10} />
        <Bar w={1} h={10} className="bg-stone-200 dark:bg-stone-700" />
        <Bar w={120} h={10} />
        <Bar w={1} h={10} className="bg-stone-200 dark:bg-stone-700" />
        <Bar w={60} h={10} />
        <div className="ml-auto">
          <Bar w={8} h={8} rounded="full" />
        </div>
      </div>
      {/* Headline */}
      <Bar w={340} h={28} className="mt-1" />

      {/* Stats row */}
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Bar w={12} h={12} rounded="sm" />
            <Bar w={36} h={14} />
            <Bar w={48} h={10} />
          </div>
        ))}
      </div>

      {/* Table — ruler + 8 rows */}
      <div className="mt-5 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
        {/* Ruler */}
        <div className="flex items-center gap-4 px-4 h-10 border-b border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-950/40">
          <Bar w={200} h={10} />
          <div className="flex-1 flex items-center gap-10">
            {Array.from({ length: 4 }).map((_, i) => (
              <Bar key={i} w={44} h={10} />
            ))}
          </div>
          <Bar w={140} h={10} />
        </div>
        {/* Rows */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-stretch gap-4 px-4 py-3 border-b border-stone-100 dark:border-stone-800 last:border-b-0"
          >
            <div className="w-[200px] shrink-0 space-y-2">
              <div className="flex items-center gap-1.5">
                <Bar w={6} h={6} rounded="full" />
                <Bar w={64} h={10} />
              </div>
              <Bar w={170} h={13} />
              <Bar w={120} h={13} />
            </div>
            <div className="flex-1 self-center">
              <Bar h={24} rounded="sm" />
            </div>
            <div className="w-[140px] shrink-0 self-center space-y-1.5 flex flex-col items-end">
              <Bar w={80} h={12} />
              <Bar w={56} h={10} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Tiny skeleton primitive — muted stone block that gently pulses.
 *  Inlined rather than pulled from a ui kit to keep the skeleton
 *  dependency-free. */
function Bar({
  w,
  h,
  rounded = "md",
  className = "",
}: {
  w?: number
  h?: number
  rounded?: "sm" | "md" | "full"
  className?: string
}) {
  const roundedClass =
    rounded === "full"
      ? "rounded-full"
      : rounded === "sm"
        ? "rounded-sm"
        : "rounded-md"
  return (
    <div
      className={`bg-stone-200/70 dark:bg-stone-800/70 animate-pulse ${roundedClass} ${className}`}
      style={{
        width: w ? `${w}px` : "100%",
        height: h ? `${h}px` : "10px",
      }}
    />
  )
}
