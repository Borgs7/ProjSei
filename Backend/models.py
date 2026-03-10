from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Float, Date, Text, TIMESTAMP
from sqlalchemy.sql import func
from geoalchemy2 import Geometry
from .database import Base

class Scenarios(Base):
    __tablename__ = 'scenarios'
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    magnitude = Column(Float, nullable=False)
    epicenter_lat = Column(Float, nullable=False)
    epicenter_lon = Column(Float, nullable=False)
    depth_km = Column(Float, nullable=False)
    event_date = Column(Date)
    description = Column(Text)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())
    is_active = Column(Boolean, default=True)
    
    # PostGIS geometry column
    epicenter_geom = Column(Geometry('POINT', srid=4326))

class PGAPoints(Base):
    __tablename__ = 'pga_points'
    
    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(Integer, ForeignKey('scenarios.id', ondelete='CASCADE'), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    pga_value = Column(Float, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())
    
    # PostGIS geometry column
    geometry = Column(Geometry('POINT', srid=4326), nullable=False)

# Optional: For Phase 3
class FaultLines(Base):
    __tablename__ = 'fault_lines'
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    fault_type = Column(String(50))
    geometry = Column(Geometry('LINESTRING', srid=4326))