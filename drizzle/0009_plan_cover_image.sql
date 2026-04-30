-- Plan cover image
--
-- A plan can carry a cover image. The column stores a URL served by
-- the studio's upload route handler (e.g. /api/operator-studio/uploads/
-- plan-covers/<planId>/<filename>). NULL means no cover.
--
-- Files live outside `public/` (under `./uploads/`) so prod builds
-- don't need to replay them at build time, and the upload handler
-- can apply auth/rate-limit before serving.

ALTER TABLE operator_plans
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
