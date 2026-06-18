"""
Import PHIVOLCS Active Faults shapefile into PostGIS.

Usage:
    cd SEISCAN_1/Backend
    python scripts/import_active_faults.py path/to/AF_Philippines.shp

What it does:
    1. Reads the shapefile (expects EPSG:4326 — verifies and reprojects if needed)
    2. Selects + renames a lean column set
    3. Normalizes a few known typos in PHIVOLCS attributes
    4. Promotes all geometries to MultiLineString for schema consistency
    5. Loads into the `fault_lines` table (creates from sql/fault_lines_schema.sql if missing)
    6. Reports a per-class summary

Idempotent? No. Re-running appends. Truncate first if you want a clean reload:
    psql -d SeiScanDB -c "TRUNCATE fault_lines RESTART IDENTITY;"

Requires:
    pip install geopandas sqlalchemy geoalchemy2 psycopg2-binary

Database connection:
    Reuses the `engine` from your existing Backend/database.py — no password
    or environment variable needed here. Your credentials stay in one place.
"""
import sys
import os
from pathlib import Path
import warnings

# Make Backend/ importable so we can reuse database.py.
# This script lives in Backend/scripts/, so the parent of its folder is Backend/.
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import geopandas as gpd
from shapely.geometry import MultiLineString, LineString
from sqlalchemy import text

# Reuse the exact same engine/connection your FastAPI app uses
from database import engine

warnings.filterwarnings('ignore')

TABLE_NAME = "fault_lines"
SCHEMA_SQL_PATH = BACKEND_DIR / "sql" / "fault_lines_schema.sql"


def load_shapefile(shp_path: Path) -> gpd.GeoDataFrame:
    print(f"[1/6] Reading shapefile: {shp_path}")
    gdf = gpd.read_file(shp_path)
    print(f"      → {len(gdf)} features, CRS={gdf.crs}")

    if gdf.crs is None:
        raise RuntimeError("Shapefile has no CRS. Check the .prj file.")
    if str(gdf.crs).upper() not in ("EPSG:4326", "WGS 84"):
        print(f"[1/6] Reprojecting from {gdf.crs} → EPSG:4326")
        gdf = gdf.to_crs(epsg=4326)
    return gdf


def transform(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    print("[2/6] Selecting and renaming columns")
    rename = {
        'd_fname':    'fault_name',
        'd_segname':  'segment_name',
        'd_fccode':   'fault_class',
        'd_ttcode':   'trace_type',
        'd_ltcode':   'symbology',
        'd_mechanis': 'mechanism',
    }
    missing = [c for c in rename if c not in gdf.columns]
    if missing:
        raise RuntimeError(f"Shapefile missing expected columns: {missing}")

    out = gdf[list(rename.keys()) + ['geometry']].rename(columns=rename)

    print("[3/6] Normalizing known PHIVOLCS attribute typos")
    out['trace_type'] = out['trace_type'].replace({
        'Approximate - Downthrown Areaa': 'Approximate - Downthrown Area',
    })
    out['symbology'] = out['symbology'].replace({
        'Solid- red':  'Solid - red',
        'Solid -red':  'Solid - red',
        'Dashed -red': 'Dashed - red',
    })

    print("[4/6] Promoting LineString → MultiLineString for schema consistency")
    def to_multi(g):
        if g is None or g.is_empty:
            return None
        if isinstance(g, LineString):
            return MultiLineString([g])
        return g  # already MultiLineString
    out['geometry'] = out['geometry'].apply(to_multi)
    out = out[out.geometry.notna()].copy()
    out = out.set_crs(epsg=4326, allow_override=True)

    # Drop rows missing the only NOT NULL business field
    bad = out['fault_class'].isna().sum()
    if bad:
        print(f"      → dropping {bad} rows with null fault_class")
        out = out[out['fault_class'].notna()]

    return out


def ensure_schema(engine):
    print("[5/6] Ensuring fault_lines table exists")
    if not SCHEMA_SQL_PATH.exists():
        raise FileNotFoundError(f"Schema file not found: {SCHEMA_SQL_PATH}")
    raw = SCHEMA_SQL_PATH.read_text()
    # Drop full-line SQL comments first, so they don't get bundled with — and
    # accidentally suppress — the statement that follows them when we split on ';'.
    lines = [ln for ln in raw.splitlines() if not ln.strip().startswith('--')]
    cleaned = "\n".join(lines)
    statements = [s.strip() for s in cleaned.split(';') if s.strip()]
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))


def load_to_postgis(gdf: gpd.GeoDataFrame, engine):
    print(f"[6/6] Writing {len(gdf)} rows → {TABLE_NAME}")
    # Our table's geometry column is named 'geom' (matching seismic_points and the
    # FaultLines model). GeoPandas defaults its active geometry column to 'geometry',
    # so rename it to 'geom' first — otherwise to_postgis looks for a 'geometry'
    # column that doesn't exist and the SRID lookup (Find_SRID) fails.
    gdf = gdf.rename_geometry('geom')
    gdf.to_postgis(
        name=TABLE_NAME,
        con=engine,
        if_exists='append',
        index=False,
    )


def report(engine):
    print("\n=== Import summary ===")
    with engine.begin() as conn:
        total = conn.execute(text(f"SELECT COUNT(*) FROM {TABLE_NAME}")).scalar()
        print(f"Total rows in {TABLE_NAME}: {total}")
        rows = conn.execute(text(
            f"SELECT fault_class, COUNT(*) FROM {TABLE_NAME} GROUP BY fault_class ORDER BY 2 DESC"
        )).fetchall()
        for cls, n in rows:
            print(f"  {cls}: {n}")
        bbox = conn.execute(text(
            f"SELECT ST_XMin(b), ST_YMin(b), ST_XMax(b), ST_YMax(b) "
            f"FROM (SELECT ST_Extent(geom) b FROM {TABLE_NAME}) t"
        )).fetchone()
        if bbox:
            print(f"  bbox: lon[{bbox[0]:.3f}, {bbox[2]:.3f}]  lat[{bbox[1]:.3f}, {bbox[3]:.3f}]")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    shp_path = Path(sys.argv[1])
    if not shp_path.exists():
        print(f"ERROR: file not found: {shp_path}")
        sys.exit(1)

    engine_msg = str(engine.url).replace(engine.url.password or "", "****")
    print(f"Using database: {engine_msg}")
    gdf = load_shapefile(shp_path)
    gdf = transform(gdf)
    ensure_schema(engine)
    load_to_postgis(gdf, engine)
    report(engine)
    print("\nDone.")


if __name__ == "__main__":
    main()