"""
Hazard layer endpoints — start with active faults.
Mount in main.py:
    from routers import hazards
    app.include_router(hazards.router)
"""
from typing import Optional
from fastapi import APIRouter, Query, HTTPException
from sqlalchemy import text

from database import engine  # adjust import to match your project layout

router = APIRouter(prefix="/api/hazards", tags=["hazards"])


@router.get("/active-faults")
def get_active_faults(
    bbox: Optional[str] = Query(
        None,
        description="Optional bounding box filter: 'minLon,minLat,maxLon,maxLat'",
        examples=["120.0,11.5,124.5,14.5"],
    ),
    fault_class: Optional[str] = Query(
        None,
        description="Filter by fault class: 'Active Fault' or 'Potentially Active Fault'",
    ),
    simplify_m: Optional[float] = Query(
        None,
        ge=0,
        le=10000,
        description="Optional Douglas-Peucker tolerance in meters. Useful at low zoom.",
    ),
):
    """
    Returns a GeoJSON FeatureCollection of active fault lines.

    Filtering:
      - bbox: standard 'minLon,minLat,maxLon,maxLat'. Uses GIST index, fast.
      - fault_class: exact match against the fault_class column.

    Server-side simplification:
      - Pass ?simplify_m=100 at low zooms to drop payload size further.
      - We reproject to a metric CRS (EPSG:3857) for accurate tolerance, then
        back to 4326 for output.
    """
    where_clauses = []
    params = {}

    if bbox:
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) != 4:
                raise ValueError
        except ValueError:
            raise HTTPException(400, "bbox must be 'minLon,minLat,maxLon,maxLat'")
        min_lon, min_lat, max_lon, max_lat = parts
        where_clauses.append(
            "geom && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)"
        )
        params.update(min_lon=min_lon, min_lat=min_lat, max_lon=max_lon, max_lat=max_lat)

    if fault_class:
        where_clauses.append("fault_class = :fault_class")
        params["fault_class"] = fault_class

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    if simplify_m and simplify_m > 0:
        # Simplify in metric CRS for predictable tolerance, then back to 4326
        geom_expr = (
            "ST_AsGeoJSON("
            "  ST_Transform("
            "    ST_SimplifyPreserveTopology("
            "      ST_Transform(geom, 3857), :tol"
            "    ), 4326"
            "  ), 5"
            ")::json"
        )
        params["tol"] = float(simplify_m)
    else:
        geom_expr = "ST_AsGeoJSON(geom, 5)::json"

    sql = text(f"""
        SELECT
            id,
            fault_name,
            segment_name,
            fault_class,
            trace_type,
            symbology,
            mechanism,
            {geom_expr} AS geometry
        FROM fault_lines
        {where_sql}
    """)

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()

    features = [
        {
            "type": "Feature",
            "id": row["id"],
            "geometry": row["geometry"],
            "properties": {
                "fault_name":   row["fault_name"],
                "segment_name": row["segment_name"],
                "fault_class":  row["fault_class"],
                "trace_type":   row["trace_type"],
                "symbology":    row["symbology"],
                "mechanism":    row["mechanism"],
            },
        }
        for row in rows
    ]
    return {"type": "FeatureCollection", "features": features}


@router.get("/active-faults/stats")
def active_faults_stats():
    """Lightweight summary for sanity-checking after import."""
    sql = text("""
        SELECT fault_class, COUNT(*) AS n
        FROM fault_lines
        GROUP BY fault_class
        ORDER BY n DESC
    """)
    with engine.connect() as conn:
        rows = conn.execute(sql).mappings().all()
        total = conn.execute(text("SELECT COUNT(*) FROM fault_lines")).scalar()
    return {"total": total, "by_class": [dict(r) for r in rows]}


@router.get("/nearest-fault")
def nearest_fault(
    lat: float = Query(..., description="Latitude of the clicked point"),
    lon: float = Query(..., description="Longitude of the clicked point"),
):
    """
    Given a clicked point, return the closest fault: its name, distance in
    meters, and the exact point on the fault nearest the click (so the
    frontend can draw a connector line).

    How it works:
      1. The `<->` KNN operator uses the GIST index to grab the 10 nearest
         candidates by planar distance — fast even across all 6,340 rows.
      2. We then re-rank those 10 by true geodesic distance (geography cast,
         metres) and take the closest. This is both fast and accurate.
      3. ST_ClosestPoint gives the point on that fault nearest the click.
    """
    sql = text("""
        SELECT
            id,
            fault_name,
            segment_name,
            fault_class,
            trace_type,
            mechanism,
            ST_Distance(geom::geography, pt::geography)                      AS distance_m,
            ST_AsGeoJSON(ST_ClosestPoint(geom, pt), 6)::json                 AS nearest_point
        FROM (
            SELECT
                id, fault_name, segment_name, fault_class, trace_type, mechanism, geom,
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS pt
            FROM fault_lines
            ORDER BY geom <-> ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)
            LIMIT 10
        ) candidates
        ORDER BY distance_m ASC
        LIMIT 1
    """)
    with engine.connect() as conn:
        row = conn.execute(sql, {"lat": lat, "lon": lon}).mappings().first()

    if row is None:
        raise HTTPException(404, "No faults found (is the fault_lines table populated?)")

    return {
        "fault_name":    row["fault_name"],
        "segment_name":  row["segment_name"],
        "fault_class":   row["fault_class"],
        "trace_type":    row["trace_type"],
        "mechanism":     row["mechanism"],
        "distance_m":    round(row["distance_m"], 1),
        "distance_km":   round(row["distance_m"] / 1000, 3),
        # GeoJSON Point: coordinates are [lon, lat] of the closest point ON the fault
        "nearest_point": row["nearest_point"],
        "clicked_point": {"type": "Point", "coordinates": [lon, lat]},
    }

@router.get("/research-faults")
def get_research_faults(
    source: Optional[str] = Query(
        None,
        description="Filter by publication, e.g. 'Frias et al. (2019)'",
    ),
    bbox: Optional[str] = Query(
        None,
        description="Bounding box filter: 'minLon,minLat,maxLon,maxLat'",
    ),
):
    """GeoJSON FeatureCollection of research-derived fault traces (Batangas)."""
    where, params = [], {}
 
    if bbox:
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) != 4:
                raise ValueError
        except ValueError:
            raise HTTPException(400, "bbox must be 'minLon,minLat,maxLon,maxLat'")
        where.append("geom && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)")
        params.update(zip(("min_lon", "min_lat", "max_lon", "max_lat"), parts))
 
    if source:
        where.append("source = :source")
        params["source"] = source
 
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
 
    sql = text(f"""
        SELECT
            id, source, mechanism, description, category, length_m,
            ST_AsGeoJSON(geom, 5)::json AS geometry
        FROM research_faults
        {where_sql}
    """)
 
    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()
 
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": r["id"],
                "geometry": r["geometry"],
                "properties": {
                    "source":      r["source"],
                    "mechanism":   r["mechanism"],
                    "description": r["description"],
                    "category":    r["category"],
                    "length_m":    float(r["length_m"]) if r["length_m"] is not None else None,
                },
            }
            for r in rows
        ],
    }
 
 
@router.get("/research-faults/stats")
def research_faults_stats():
    """Summary by publication — for sanity-checking after import."""
    sql = text("""
        SELECT source,
               COUNT(*) AS n,
               ROUND((SUM(length_m) / 1000)::numeric, 1) AS total_km
        FROM research_faults
        GROUP BY source
        ORDER BY n DESC
    """)
    with engine.connect() as conn:
        rows = conn.execute(sql).mappings().all()
        total = conn.execute(text("SELECT COUNT(*) FROM research_faults")).scalar()
    return {
        "total": total,
        "by_source": [
            {"source": r["source"], "features": r["n"], "total_km": float(r["total_km"])}
            for r in rows
        ],
    }