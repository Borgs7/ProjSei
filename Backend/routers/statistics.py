from fastapi import APIRouter

router = APIRouter(prefix="/api/statistics", tags=["Statistics"])

# TODO: Phase 2 - Add endpoints for:
# - PGA distribution histograms
# - Affected area calculations
# - Population exposure estimates