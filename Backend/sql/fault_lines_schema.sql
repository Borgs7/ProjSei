-- ============================================================
-- SeiScanPH: fault_lines table
-- ============================================================
-- Compare against your existing FaultLines model in models.py.
-- If the existing definition differs, update models.py to match
-- this schema (or vice versa — but these columns are the ones
-- the import script expects and the API endpoint returns).
-- ============================================================

-- Drop existing table if you need a clean rebuild (DESTRUCTIVE):
-- DROP TABLE IF EXISTS fault_lines CASCADE;

CREATE TABLE IF NOT EXISTS fault_lines (
    id              SERIAL PRIMARY KEY,
    fault_name      TEXT,           -- d_fname  e.g. "Philippine Fault"
    segment_name    TEXT,           -- d_segname e.g. "Pugo Segment"
    fault_class     TEXT NOT NULL,  -- d_fccode "Active Fault" | "Potentially Active Fault"
    trace_type      TEXT,           -- d_ttcode "Certain" | "Approximate" | ...
    symbology       TEXT,           -- d_ltcode raw PHIVOLCS line style code
    mechanism       TEXT,           -- d_mechanis "Strike-Slip" | "Normal" | "Reverse" | "Oblique"
    geom            GEOMETRY(MultiLineString, 4326) NOT NULL,
    imported_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index for bbox queries
CREATE INDEX IF NOT EXISTS idx_fault_lines_geom
    ON fault_lines USING GIST (geom);

-- Filter indexes for common queries (active vs potentially active)
CREATE INDEX IF NOT EXISTS idx_fault_lines_class
    ON fault_lines (fault_class);

CREATE INDEX IF NOT EXISTS idx_fault_lines_name
    ON fault_lines (fault_name);

-- Comments for self-documentation
COMMENT ON TABLE fault_lines IS 'PHIVOLCS Active Faults of the Philippines (AF_Philippines.shp)';
COMMENT ON COLUMN fault_lines.fault_class IS 'Active Fault or Potentially Active Fault';
COMMENT ON COLUMN fault_lines.trace_type IS 'Certainty/character of mapped trace';
COMMENT ON COLUMN fault_lines.symbology IS 'Original PHIVOLCS symbology code (preserved for future MapLibre styling)';