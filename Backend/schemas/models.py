from pydantic import BaseModel, Field, field_validator
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
    latitude: float = Field(..., ge=4.0, le=22.0)
    longitude: float = Field(..., ge=114.0, le=130.0)
    num_points: int = Field(default=8, ge=1, le=20)

    @field_validator('num_points')
    @classmethod
    def validate_num_points(cls, v):
        if v > 20:
            raise ValueError('num_points must be <= 20')
        return v


class IntensityResponse(BaseModel):
    status: str
    location: dict
    pga_value: Optional[float] = None
    mmi: Optional[int] = None
    intensity_level: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    text_color: Optional[str] = None
    distance_from_epicenter_km: Optional[float] = None
    nearest_points_used: Optional[int] = None
    nearest_point_distance_km: Optional[float] = None
    epicenter: Optional[dict] = None
    method: Optional[str] = None

