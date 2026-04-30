import type { Metadata } from "next"

import { SearchResults } from "./search-results"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Search" }

export default function SearchPage() {
  return <SearchResults />
}
