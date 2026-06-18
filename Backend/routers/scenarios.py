from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List
import models
from database import get_db
from schemas.models import ScenarioResponse

router = APIRouter(prefix="/api/scenarios", tags=["Scenarios"])


@router.get("/", response_model=List[ScenarioResponse])
async def get_scenarios(db: Session = Depends(get_db)):
    """Get all active earthquake scenarios"""
    scenarios = db.query(models.Scenarios).filter(
        models.Scenarios.is_active == True
    ).all()
    return scenarios


@router.get("/{scenario_id}", response_model=ScenarioResponse)
async def get_scenario(scenario_id: int, db: Session = Depends(get_db)):
    """Get a specific scenario by ID"""
    scenario = db.query(models.Scenarios).filter(
        models.Scenarios.id == scenario_id
    ).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return scenario


@router.get("/default/epicenter")
async def get_default_epicenter():
    """Default Calapan M7.1 epicenter — works even before scenarios table has data."""
    return {
        "id": 1,
        "name": "M 7.1 Calapan Earthquake",
        "magnitude": 7.1,
        "epicenter_lat": 13.4251,
        "epicenter_lon": 121.0220,
        "depth_km": 10,
        "description": "Simulated M 7.1 earthquake near Calapan, Oriental Mindoro",
        "is_active": True
    }