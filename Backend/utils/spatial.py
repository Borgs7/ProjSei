import math
from typing import List, Dict, Tuple, Optional


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points. Returns km."""
    R = 6371
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
                    nearest_points: List[Dict], power: int = 2) -> Optional[float]:
    """
    Inverse Distance Weighting interpolation.
    Points should have keys: latitude, longitude, pga_cm_s2
    """
    if not nearest_points:
        return None

    for point in nearest_points:
        distance = haversine_distance(
            click_lat, click_lon, point['latitude'], point['longitude']
        )
        if distance < 0.1:
            return point['pga_cm_s2']

    numerator = 0.0
    denominator = 0.0

    for point in nearest_points:
        distance = haversine_distance(
            click_lat, click_lon, point['latitude'], point['longitude']
        )
        if distance < 0.001:
            return point['pga_cm_s2']

        weight = 1.0 / (distance ** power)
        numerator += weight * point['pga_cm_s2']
        denominator += weight

    return numerator / denominator if denominator > 0 else None


def pga_to_mmi(pga: float) -> int:
    """Convert PGA (cm/s²) to MMI using Wald et al. (1999)"""
    if not pga or pga <= 0:
        return 1
    log_pga = math.log10(pga)
    if log_pga <= 1.82:
        mmi = 2.20 * log_pga + 1.00
    else:
        mmi = 3.66 * log_pga - 1.66
    return max(1, min(10, round(mmi)))


def get_intensity_description(mmi: int) -> dict:
    """Get full MMI intensity description with color."""
    descriptions = {
        1:  {"level": "I - Not Felt",      "description": "Not felt except by very few under especially favorable conditions.", "color": "#FFFFFF", "textColor": "#333"},
        2:  {"level": "II - Weak",          "description": "Felt only by few persons at rest, especially on upper floors.", "color": "#BFCCFF", "textColor": "#333"},
        3:  {"level": "III - Weak",         "description": "Felt quite noticeably indoors. Standing motor cars may rock slightly.", "color": "#9FD9FF", "textColor": "#333"},
        4:  {"level": "IV - Light",         "description": "Felt indoors by many, outdoors by few. Dishes and windows disturbed.", "color": "#7FFFE6", "textColor": "#333"},
        5:  {"level": "V - Moderate",       "description": "Felt by nearly everyone. Some dishes and windows broken. Unstable objects overturned.", "color": "#7FFF7F", "textColor": "#333"},
        6:  {"level": "VI - Strong",        "description": "Felt by all. Many frightened. Some heavy furniture moved. Slight structural damage.", "color": "#FFFF00", "textColor": "#333"},
        7:  {"level": "VII - Very Strong",  "description": "Most people alarmed. Considerable damage to poorly built structures.", "color": "#FFD27F", "textColor": "#333"},
        8:  {"level": "VIII - Severe",      "description": "Considerable damage in ordinary buildings. Fall of chimneys and monuments.", "color": "#FFA500", "textColor": "white"},
        9:  {"level": "IX - Violent",       "description": "Considerable damage in specially designed structures. Ground cracked conspicuously.", "color": "#FF7F7F", "textColor": "white"},
        10: {"level": "X - Extreme",        "description": "Most masonry and frame structures destroyed. Ground badly cracked. Large landslides.", "color": "#FF0000", "textColor": "white"}
    }
    return descriptions.get(mmi, descriptions[5])