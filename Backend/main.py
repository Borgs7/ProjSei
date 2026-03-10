from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Annotated
from . import models
from .database import engine, SessionLocal

# Create FastAPI app
app = FastAPI(
    title="SeiScanPH API",
    description="Earthquake Hazard Mapping API for the Philippines",
    version="2.0.0"
)

# Create database tables
models.Base.metadata.create_all(bind=engine)

# CORS middleware (allows frontend to call API)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production: specify your domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database dependency (learned in Week 1!)
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

db_dependency = Annotated[Session, Depends(get_db)]

# Root endpoint
@app.get("/")
def root():
    return {
        "message": "SeiScanPH API v2.0",
        "status": "online",
        "endpoints": {
            "scenarios": "/api/scenarios",
            "docs": "/docs"
        }
    }

# Health check (learned in Week 1!)
@app.get("/health")
async def health_check(db: db_dependency):
    try:
        # Test database connection
        db.execute(text("SELECT 1"))
        return {
            "status": "healthy",
            "database": "connected"
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "database": "disconnected",
            "error": str(e)
        }
