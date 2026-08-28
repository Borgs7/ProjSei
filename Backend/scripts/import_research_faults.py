"""
Import published research fault / tectonic shapefiles into PostGIS.

This REPLACES the earlier import_research_faults.py — it now handles four
datasets instead of three, adding the Bacud (1997, Revised) Tectonic Map.

Usage — from the Backend folder:
    python scripts/import_research_faults.py "C:\\path\\to\\folder_with_shapefiles"

Point it at the FOLDER containing the .shp files. It imports whichever of the
four known datasets it finds and skips the rest with a warning.

Datasets handled:
    Austria et al. (2023)               5 traces   Batangas        EPSG:4326
    Frias et al. (2019)                 3 traces   Batangas        UTM 51N → reprojected
    Rohrlach (2012)                   193 traces   Batangas        UTM 51N → reprojected
    Bacud (1997, Revised) Tectonic    279 traces   Sibuyan Sea     EPSG:4326

PREREQUISITE: run sql/add_category_column.sql once before the first run that
includes Bacud, so the `category` column exists.

Idempotent? No — re-running appends. For a clean reload:
    TRUNCATE research_faults RESTART IDENTITY;

Database connection: reuses `engine` from Backend/database.py.
"""
import sys
from pathlib import Path
import warnings

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import geopandas as gpd
import pandas as pd
from shapely.geometry import MultiLineString, LineString
from sqlalchemy import text

from database import engine

warnings.filterwarnings("ignore")

TABLE_NAME = "research_faults"
SCHEMA_SQL_PATH = BACKEND_DIR / "sql" / "research_faults_schema.sql"
METRIC_CRS = 32651  # UTM Zone 51N — correct for this region, used for lengths in metres

# keyword → (citation, mechanism col, description col, category col)
#
# Matched by KEYWORD, not exact filename. The real files carry punctuation that
# varies between exports — "Austria_et.al(2023).shp", "Austria_et_al_2023_.shp",
# "Austria et al (2023).shp" all work. We just look for the author's name
# (case-insensitive) anywhere in the .shp filename.
DATASETS = {
    "austria":  ("Austria et al. (2023)",              None,    None,   None),
    "frias":    ("Frias et al. (2019)",                "Sense", None,   None),
    "rohrlach": ("Rohrlach (2012)",                    None,    "Desc", None),
    "bacud":    ("Bacud (1997, Revised) Tectonic Map", None,    None,   "id"),
}


def find_shapefile(folder: Path, keyword: str):
    """Return the .shp in `folder` whose name contains `keyword` (case-insensitive)."""
    matches = [p for p in folder.glob("*.shp") if keyword in p.name.lower()]
    if not matches:
        return None
    if len(matches) > 1:
        print(f"  NOTE: {len(matches)} files match '{keyword}'; using {matches[0].name}")
    return matches[0]


def to_multi(g):
    if g is None or g.is_empty:
        return None
    return MultiLineString([g]) if isinstance(g, LineString) else g


def load_one(shp_path: Path, citation, mech_col, desc_col, cat_col) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(shp_path)
    if gdf.crs is None:
        raise RuntimeError(f"{shp_path.name}: no CRS (.prj missing?)")

    # Drop empty geometries (Bacud has one) before anything else
    before = len(gdf)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    dropped = before - len(gdf)

    original_crs = gdf.crs.to_string()
    if gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
        note = f"{original_crs} → EPSG:4326 (reprojected)"
    else:
        note = "EPSG:4326"

    out = gpd.GeoDataFrame({
        "source":      citation,
        "mechanism":   gdf[mech_col] if mech_col and mech_col in gdf.columns else None,
        "description": gdf[desc_col] if desc_col and desc_col in gdf.columns else None,
        # Bacud's `id` is a class label, not an identifier — render it readably
        "category":    gdf[cat_col].apply(lambda v: f"Class {v}")
                       if cat_col and cat_col in gdf.columns else None,
        "geometry":    gdf.geometry,
    }, crs="EPSG:4326")

    for c in ("mechanism", "description", "category"):
        out[c] = out[c].where(pd.notna(out[c]), None)

    out["length_m"] = out.to_crs(epsg=METRIC_CRS).geometry.length.round(1)
    out["geometry"] = out["geometry"].apply(to_multi)
    out = out[out.geometry.notna()].set_crs(epsg=4326, allow_override=True)

    extra = f"  ({dropped} empty geometry dropped)" if dropped else ""
    print(f"  {citation:36s} {len(out):4d} features   {note}{extra}")
    return out


def _strip_sql_comments(raw: str) -> str:
    """
    Remove SQL line comments, including INLINE ones (code -- comment).

    This matters because we split statements on ';' — a semicolon sitting
    inside a comment would otherwise truncate the statement before it.
    We track single-quote string literals so a '--' inside a quoted string
    is left alone.
    """
    out_lines = []
    for line in raw.splitlines():
        in_str = False
        cut = None
        i = 0
        while i < len(line):
            ch = line[i]
            if ch == "'":
                in_str = not in_str
            elif not in_str and ch == '-' and i + 1 < len(line) and line[i + 1] == '-':
                cut = i
                break
            i += 1
        out_lines.append(line[:cut] if cut is not None else line)
    return "\n".join(out_lines)


def ensure_schema():
    if not SCHEMA_SQL_PATH.exists():
        raise FileNotFoundError(f"Schema file not found: {SCHEMA_SQL_PATH}")
    cleaned = _strip_sql_comments(SCHEMA_SQL_PATH.read_text())
    statements = [s.strip() for s in cleaned.split(";") if s.strip()]
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
        # Self-heal if an older schema without `category` was used previously
        conn.execute(text(
            f"ALTER TABLE {TABLE_NAME} ADD COLUMN IF NOT EXISTS category TEXT"
        ))


def report():
    print("\n=== Import summary ===")
    with engine.begin() as conn:
        total = conn.execute(text(f"SELECT COUNT(*) FROM {TABLE_NAME}")).scalar()
        print(f"Total rows in {TABLE_NAME}: {total}")
        for src, n, km in conn.execute(text(
            f"SELECT source, COUNT(*), ROUND((SUM(length_m)/1000)::numeric,1) "
            f"FROM {TABLE_NAME} GROUP BY source ORDER BY 2 DESC"
        )):
            print(f"  {src:36s} {n:4d} features   {km} km")
        bbox = conn.execute(text(
            f"SELECT ST_XMin(b), ST_YMin(b), ST_XMax(b), ST_YMax(b) "
            f"FROM (SELECT ST_Extent(geom) b FROM {TABLE_NAME}) t"
        )).fetchone()
        if bbox and bbox[0] is not None:
            print(f"  bbox: lon[{bbox[0]:.4f}, {bbox[2]:.4f}]  lat[{bbox[1]:.4f}, {bbox[3]:.4f}]")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    folder = Path(sys.argv[1])
    if not folder.is_dir():
        print(f"ERROR: not a folder: {folder}")
        sys.exit(1)

    print(f"Using database: {str(engine.url).replace(engine.url.password or '', '****')}")
    print(f"[1/3] Reading shapefiles from: {folder}")

    frames = []
    for keyword, (citation, mech, desc, cat) in DATASETS.items():
        shp = find_shapefile(folder, keyword)
        if shp is None:
            print(f"  WARNING: no .shp matching '{keyword}' — skipping")
            continue
        frames.append(load_one(shp, citation, mech, desc, cat))

    if not frames:
        print("\nERROR: no matching shapefiles found in that folder.")
        found = sorted(p.name for p in folder.glob("*.shp"))
        if found:
            print("  .shp files actually present:")
            for f in found:
                print(f"    - {f}")
            print("  None contain 'austria', 'frias', 'rohrlach' or 'bacud'.")
        else:
            print("  No .shp files at all in that folder — check the path.")
        sys.exit(1)

    combined = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs="EPSG:4326")
    print(f"      → {len(combined)} features total")

    print("[2/3] Ensuring research_faults table exists")
    ensure_schema()

    print(f"[3/3] Writing {len(combined)} rows → {TABLE_NAME}")
    combined = combined.rename_geometry("geom")
    combined.to_postgis(name=TABLE_NAME, con=engine, if_exists="append", index=False)

    report()
    print("\nDone.")


if __name__ == "__main__":
    main()