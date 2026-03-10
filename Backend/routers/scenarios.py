from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List
import models
from database import SessionLocal
from schemas.models import ScenarioResponse

router = APIRouter(prefix="/api/scenarios", tags=["Scenarios"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.get("/", response_model=List[ScenarioResponse])
async def get_scenarios(db: Session = Depends(get_db)):
    """Get all earthquake scenarios"""
    scenarios = db.query(models.Scenarios).filter(
        models.Scenarios.is_active == True
    ).all()
    return scenarios

@router.get("/{scenario_id}", response_model=ScenarioResponse)
async def get_scenario(scenario_id: int, db: Session = Depends(get_db)):
    """Get specific scenario"""
    scenario = db.query(models.Scenarios).filter(
        models.Scenarios.id == scenario_id
    ).first()
    
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    
    return scenario