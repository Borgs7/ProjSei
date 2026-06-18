from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
import models
from database import get_db
from utils.spatial import haversine_distance, interpolate_idw, pga_to_mmi, get_intensity_description

router = APIRouter(prefix="/api/calculate", tags=["Calculations"])

# Epicenter data (Calapan M7.1) - hardcoded for now, Phase 2 will pull from scenarios table
EPICENTER = {
    "lat": 13.4251,
    "lon": 121.0220,
    "magnitude": 7.1,
    "depth_km": 10,
    "name": "Calapan, Mindoro"
}


@router.get("/intensity")
async def calculate_intensity(
    lat: float = Query(..., ge=4.0, le=22.0, description="Latitude (Philippines range)"),
    lon: float = Query(..., ge=114.0, le=130.0, description="Longitude (Philippines range)"),
    num_points: int = Query(default=8, ge=1, le=20, description="Number of nearest points for IDW"),
    db: Session = Depends(get_db)
):
    """
    Calculate earthquake intensity at a clicked location.
    Flow: Click → Find nearest PGA points via PostGIS → IDW interpolation → PGA to MMI → Response
    """
    try:
        # STEP 1: Query nearest PGA points from PostGIS
        query = text("""
            SELECT
                latitude,
                longitude,
                pga_cm_s2,
                ST_Distance(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                ) / 1000.0 AS distance_km
            FROM seismic_points
            ORDER BY geom <-> ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)
            LIMIT :num_points
        """)

        result = db.execute(query, {"lat": lat, "lon": lon, "num_points": num_points})
        rows = result.fetchall()

        if not rows:
            raise HTTPException(status_code=404, detail="No PGA data points found in the database")

        nearest_points = [
            {
                "latitude": row.latitude,
                "longitude": row.longitude,
                "pga_cm_s2": row.pga_cm_s2,
                "distance_km": row.distance_km
            }
            for row in rows
        ]

         # STEP 2: Check if click is within data coverage
        nearest_distance = nearest_points[0]["distance_km"]
        MAX_DATA_DISTANCE_KM = 20  # Must be within 20km of a data point

        # Bounding box check (from actual data extent + small buffer)
        DATA_BOUNDS = {
            "min_lat": 11.6, "max_lat": 14.2,
            "min_lon": 120.0, "max_lon": 124.3
        }

        distance_from_epicenter = haversine_distance(lat, lon, EPICENTER["lat"], EPICENTER["lon"])

        out_of_bounds = (
            lat < DATA_BOUNDS["min_lat"] or lat > DATA_BOUNDS["max_lat"] or
            lon < DATA_BOUNDS["min_lon"] or lon > DATA_BOUNDS["max_lon"]
        )

        if out_of_bounds or nearest_distance > MAX_DATA_DISTANCE_KM:
            return {
                "status": "outside_coverage",
                "message": "Location is outside the M 7.1 Calapan earthquake simulation coverage",
                "nearest_data_point_km": round(nearest_distance, 1),
                "distance_from_epicenter_km": round(distance_from_epicenter, 1),
                "location": {"lat": lat, "lon": lon}
            }

        # STEP 3: IDW Interpolation
        pga_value = interpolate_idw(lat, lon, nearest_points)

        if pga_value is None:
            raise HTTPException(status_code=500, detail="IDW interpolation failed")

        # STEP 4: Convert PGA → MMI (Wald et al. 1999)
        mmi = pga_to_mmi(pga_value)
        intensity_info = get_intensity_description(mmi)

        # RESPONSE
        return {
            "status": "success",
            "location": {"lat": round(lat, 4), "lon": round(lon, 4)},
            "pga_value": round(pga_value, 2),
            "mmi": mmi,
            "intensity_level": intensity_info["level"],
            "description": intensity_info["description"],
            "color": intensity_info["color"],
            "text_color": intensity_info["textColor"],
            "distance_from_epicenter_km": round(distance_from_epicenter, 1),
            "nearest_points_used": len(nearest_points),
            "nearest_point_distance_km": round(nearest_distance, 2),
            "epicenter": EPICENTER,
            "method": "IDW Interpolation (Wald et al. 1999)"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calculation error: {str(e)}")


@router.get("/pga-at-point")
async def get_pga_at_point(
    lat: float = Query(..., ge=4.0, le=22.0),
    lon: float = Query(..., ge=114.0, le=130.0),
    radius_km: float = Query(default=5.0, ge=0.1, le=50.0),
    db: Session = Depends(get_db)
):
    """Get raw PGA points within a radius — useful for debugging."""
    query = text("""
        SELECT
            latitude, longitude, pga_cm_s2,
            ST_Distance(
                geom::geography,
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
            ) / 1000.0 AS distance_km
        FROM seismic_points
        WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
            :radius_m
        )
        ORDER BY distance_km
        LIMIT 50
    """)

    result = db.execute(query, {"lat": lat, "lon": lon, "radius_m": radius_km * 1000})
    rows = result.fetchall()

    return {
        "location": {"lat": lat, "lon": lon},
        "radius_km": radius_km,
        "points_found": len(rows),
        "points": [
            {
                "latitude": round(row.latitude, 4),
                "longitude": round(row.longitude, 4),
                "pga_cm_s2": round(row.pga_cm_s2, 2),
                "distance_km": round(row.distance_km, 3)
            }
            for row in rows
        ]
    }


@router.get("/stats")
async def get_data_stats(db: Session = Depends(get_db)):
    """Summary statistics of PGA data — good for verifying data is loaded."""
    query = text("""
        SELECT
            COUNT(*) as total_points,
            MIN(pga_cm_s2) as min_pga,
            MAX(pga_cm_s2) as max_pga,
            AVG(pga_cm_s2) as avg_pga,
            MIN(latitude) as min_lat,
            MAX(latitude) as max_lat,
            MIN(longitude) as min_lon,
            MAX(longitude) as max_lon
        FROM seismic_points
    """)

    result = db.execute(query).fetchone()

    return {
        "total_points": result.total_points,
        "pga_range": {
            "min": round(result.min_pga, 2),
            "max": round(result.max_pga, 2),
            "avg": round(result.avg_pga, 2),
            "unit": "cm/s²"
        },
        "coverage": {
            "lat_range": [round(result.min_lat, 4), round(result.max_lat, 4)],
            "lon_range": [round(result.min_lon, 4), round(result.max_lon, 4)]
        }
    }