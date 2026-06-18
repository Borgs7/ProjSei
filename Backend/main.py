from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from database import engine, get_db
import models

# Import routers
from routers import calculations, scenarios, statistics, hazards

# ============================================
# SEISCANPH API - v2.0
# ============================================

app = FastAPI(
    title="SeiScanPH API",
    description="Earthquake Hazard Mapping API for the Philippines",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Create database tables (scenarios, fault_lines - seismic_points already exists)
models.Base.metadata.create_all(bind=engine)

# CORS middleware - allows your frontend to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:3000",
        "http://localhost:8080",
        "*"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# REGISTER ROUTERS
# ============================================
app.include_router(calculations.router)
app.include_router(scenarios.router)
app.include_router(statistics.router)
app.include_router(hazards.router)


# ============================================
# ROOT & HEALTH ENDPOINTS
# ============================================
@app.get("/")
def root():
    return {
        "message": "SeiScanPH API v2.0",
        "status": "online",
        "endpoints": {
            "calculate_intensity": "/api/calculate/intensity?lat=13.4&lon=121.0",
            "pga_at_point": "/api/calculate/pga-at-point?lat=13.4&lon=121.0",
            "data_stats": "/api/calculate/stats",
            "scenarios": "/api/scenarios",
            "default_epicenter": "/api/scenarios/default/epicenter",
            "active_faults": "/api/hazards/active-faults",
            "fault_stats": "/api/hazards/active-faults/stats",
            "docs": "/docs"
        }
    }


@app.get("/health")
async def health_check():
    db = next(get_db())
    try:
        db.execute(text("SELECT 1"))
        count = db.execute(text("SELECT COUNT(*) FROM seismic_points")).scalar()
        return {
            "status": "healthy",
            "database": "connected",
            "seismic_points_loaded": count
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "database": "disconnected",
            "error": str(e)
        }
    finally:
        db.close()