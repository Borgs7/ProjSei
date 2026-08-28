-- ============================================================
-- Add a `category` column to research_faults
-- ============================================================
-- Needed for the Bacud (1997, Revised) Tectonic Map, whose only
-- attribute is an `id` field with two values (1 and 2) that
-- distinguishes two classes of structure. What those classes MEAN
-- is not recorded in the shapefile — see the note below.
--
-- Safe and additive: existing rows get NULL, nothing is modified
-- or deleted. Run this whether or not you've already imported the
-- Austria / Frias / Rohrlach data.
-- ============================================================

ALTER TABLE research_faults
    ADD COLUMN IF NOT EXISTS category TEXT;

COMMENT ON COLUMN research_faults.category IS
    'Source-defined class. For Bacud (1997): "Class 1" (66 long traces, median 13.9 km) vs "Class 2" (213 shorter traces, median 3.6 km). Semantic meaning not recorded in the shapefile — confirm with the data provider before presenting to the public.';

-- Optional index if you plan to filter by category
CREATE INDEX IF NOT EXISTS idx_research_faults_category
    ON research_faults (category);