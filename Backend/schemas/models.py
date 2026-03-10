from pydantic import BaseModel, Field, validator
from typing import Optional
from datetime import date

class ScenarioBase(BaseModel):
    name: str = Field(..., min_length=5, max_length=255)
    magnitude: float = Field(..., ge=1.0, le=10.0)
    epicenter_lat: float = Field(..., ge=-90, le=90)
    epicenter_lon: float = Field(..., ge=-180, le=180)
    depth_km: float = Field(..., ge=0, le=1000)
    event_date: Optional[date] = None
    description: Optional[str] = None

class ScenarioResponse(ScenarioBase):
    id: int
    is_active: bool
    data_points: Optional[int] = None
    
    class Config:
        from_attributes = True

class IntensityRequest(BaseModel):
    scenario_id: int = Field(..., gt=0)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    num_points: int = Field(default=8, ge=1, le=20)
    
    @validator('num_points')
    def validate_num_points(cls, v):
        if v > 20:
            raise ValueError('num_points must be <= 20')
        return v

class IntensityResponse(BaseModel):
    scenario_id: int
    location: dict
    pga_value: float
    mmi: int
    intensity_level: str
    description: str
    distance_from_epicenter_km: float
    nearest_points_used: int