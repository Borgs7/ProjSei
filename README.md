# SeiScanPH - Earthquake Hazard Mapping

Interactive web-based earthquake hazard mapping platform for the Philippines(Southern-Luzon Area).

Status: Initial Simple Site v2.0 (Dec 2025)

### Current Features
- Interactive PGA (Peak Ground Acceleration) visualization
- Click-anywhere intensity calculator (25,000+ data points)
- pga (cm/s^2) to MMI using Wald et al. (1999) USGS formula
- Layer toggle controls exported from QGIS (PGA, contours, boundaries, epicenter)
- Multiple basemaps (Terrain, OpenStreetMap)
- Info panel
- Outside coverage detection (Will say "No current data" as of now)

### What Can Be Seen (so far)?
**M 7.1 Calapan Earthquake** (April 4, 2017) [Only 1 epicenter so far for v2.0]
- Epicenter: 13.4251°N, 121.0220°E
- Depth: 10 km

### Tech Stack
- **Frontend:** HTML, CSS, JavaScript
- **Mapping:** Leaflet.js, Georaster
- **DB used:** PostgreSQL + PostGIS
- **Simulations:** Python (PyGMT, GeoPandas)
- **Design:** QGIS

### How to Run (Locally)
1. Clone repository
2. Open `index.html` with Live Server in VS Code
3. Click anywhere on map to calculate earthquake intensity


### Developer
Borgy Vinarao

---
**Version:** 2.0 (Phase 1 90% completed)  
**Last Updated:** December 15, 2025
