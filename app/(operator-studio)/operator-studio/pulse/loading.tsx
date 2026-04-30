import { PulseSkeleton } from "./pulse-skeleton"

// Route-level loading fallback. Renders the canvas-shaped skeleton
// so the shape of the page doesn't pop when data resolves.
export default function PulseLoading() {
  return <PulseSkeleton />
}
