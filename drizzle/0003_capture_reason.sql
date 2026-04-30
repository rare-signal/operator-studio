-- Short AI-generated "why capture this?" rationale attached at ingest time.
-- Populated by deriveCaptureReason() in the ingest flow. Nullable — falls
-- back to empty when no LLM endpoint is configured.

ALTER TABLE operator_threads
  ADD COLUMN IF NOT EXISTS capture_reason TEXT;
