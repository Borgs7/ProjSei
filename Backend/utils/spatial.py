import math
from typing import List, Dict, Tuple

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate distance between two points using Haversine formula
    Returns distance in kilometers
    """
    R = 6371  # Earth radius in km
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = (math.sin(delta_lat / 2) ** 2 +
         math.cos(lat1_rad) * math.cos(lat2_rad) *
         math.sin(delta_lon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c

def interpolate_idw(click_lat: float, click_lon: float, 
                   nearest_points: List[Dict], power: int = 2) -> float:
    """
    Inverse Distance Weighting interpolation
    """
    if not nearest_points:
        return None
    
    # If very close to a point (< 100m), return that value
    for point in nearest_points:
        distance = haversine_distance(
            click_lat, click_lon,
            point['latitude'], point['longitude']
        )
        if distance < 0.1:
            return point['pga_value']
    
    numerator = 0
    denominator = 0
    
    for point in nearest_points:
        distance = haversine_distance(
            click_lat, click_lon,
            point['latitude'], point['longitude']
        )
        
        if distance < 0.001:
            return point['pga_value']
        
        weight = 1 / (distance ** power)
        numerator += weight * point['pga_value']
        denominator += weight
    
    return numerator / denominator if denominator > 0 else None

def pga_to_mmi(pga: float) -> int:
    """
    Convert PGA (cm/s²) to MMI using Wald et al. (1999)
    """
    if not pga or pga <= 0:
        return 1
    
    log_pga = math.log10(pga)
    
    if log_pga <= 1.82:
        mmi = 2.20 * log_pga + 1.00
    else:
        mmi = 3.66 * log_pga - 1.66
    
    return max(1, min(10, round(mmi)))

def get_intensity_description(mmi: int) -> Tuple[str, str]:
    """Get MMI description"""
    descriptions = {
        1: ("I - Not Felt", "Not felt except by very few under especially favorable conditions."),
        2: ("II - Weak", "Felt only by few persons at rest, especially on upper floors."),
        # ... add rest from click-calculator.js
        10: ("X - Extreme", "Most masonry and frame structures destroyed.")
    }
    return descriptions.get(mmi, descriptions[5])