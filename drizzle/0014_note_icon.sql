-- Per-note icon — small lucide-react icon name string (e.g. "Star",
-- "Lightbulb", "Bug"). Nullable: null falls back to a default
-- bullet/dot in the row UI. The column is opaque to the server; the
-- client owns the curated set and renders by name.

ALTER TABLE operator_notes ADD COLUMN IF NOT EXISTS icon text;
