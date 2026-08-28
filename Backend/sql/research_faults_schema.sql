-- ============================================================
-- SeiScanPH: research_faults table
-- ============================================================
-- Fault and tectonic traces digitized from published academic
-- research. Kept SEPARATE from the PHIVOLCS `fault_lines` table
-- to preserve provenance: PHIVOLCS is the official national
-- catalog, these are individual research publications.
--
-- Creates a NEW table. Does NOT touch fault_lines or seismic_points.
--
-- NOTE: no semicolons appear inside comments or string literals in
-- this file. The import script splits statements on the semicolon,
-- so a stray one inside a comment would truncate a statement.
-- ============================================================

-- For a clean rebuild (DESTRUCTIVE - only affects research_faults):
-- DROP TABLE IF EXISTS research_faults CASCADE

CREATE TABLE IF NOT EXISTS research_faults (
    id           SERIAL PRIMARY KEY,
    source       TEXT NOT NULL,
    mechanism    TEXT,
    description  TEXT,
    category     TEXT,
    length_m     DOUBLE PRECISION,
    geom         GEOMETRY(MultiLineString, 4326) NOT NULL,
    imported_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Column meanings:
--   source      publication citation, e.g. Frias et al. (2019)
--   mechanism   Normal / Reverse / NULL  (only Frias supplies this)
--   description free text from source. For Rohrlach (2012) this is
--               cartographic styling, not geology
--   category    source-defined class. For Bacud (1997) this is
--               Class 1 or Class 2, meaning not recorded in the file
--   length_m    geodesic length. These datasets carry no fault names,
--               so length is the main quantitative descriptor

CREATE INDEX IF NOT EXISTS idx_research_faults_geom
    ON research_faults USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_research_faults_source
    ON research_faults (source);

CREATE INDEX IF NOT EXISTS idx_research_faults_category
    ON research_faults (category);

COMMENT ON TABLE research_faults IS 'Fault and tectonic traces from published academic research. Separate from PHIVOLCS fault_lines to preserve provenance.';

COMMENT ON COLUMN research_faults.source IS 'Publication citation, the authoritative provenance for each feature';

COMMENT ON COLUMN research_faults.category IS 'Source-defined class. For Bacud 1997 this is Class 1 or Class 2, semantic meaning not recorded in the shapefile.';