from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Float, Date, Text, TIMESTAMP
from sqlalchemy.sql import func
from geoalchemy2 import Geometry
from database import Base

# ============================================
# ORM MODELS - Matching your actual SeiScanDB tables
# ============================================


class Scenarios(Base):
    """Earthquake scenario metadata"""
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
    epicenter_geom = Column(Geometry('POINT', srid=4326))


class SeismicPoints(Base):
    """
    PGA data points - matches your ACTUAL 'seismic_points' table in SeiScanDB
    Columns: latitude, longitude, pga_cm_s2, geom
    """
    __tablename__ = 'seismic_points'

    id = Column(Integer, primary_key=True, index=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    pga_cm_s2 = Column(Float, nullable=False)
    geom = Column(Geometry('POINT', srid=4326))


class FaultLines(Base):
    """Philippine fault lines - Phase 3"""
    __tablename__ = 'fault_lines'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    fault_type = Column(String(50))
    geometry = Column(Geometry('LINESTRING', srid=4326))