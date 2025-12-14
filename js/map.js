// Initialize the map
// Centered on Calapan area with appropriate zoom level
const map = L.map('map').setView([13.4251, 121.0220], 9);

// Add Stamen Terrain basemap
const terrainLayer = L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png', {
    attribution: '© Stamen Design, © OpenStreetMap contributors',
    maxZoom: 18
});

// Add OpenStreetMap basemap
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
});

// Add terrain layer to map by default
terrainLayer.addTo(map);

// LAYER REFERENCES (for layer control)
let pgaRasterLayer = null;
let contoursLayer = null;
let phBoundaryLayer = null;
let epicenterLayer = null;

// LOAD PHILIPPINES BOUNDARY (GeoJSON)
fetch('data/ph_boundary.geojson')
    .then(response => {
        if (!response.ok) {
            throw new Error('Philippines boundary file not found');
        }
        return response.json();
    })
    .then(data => {
        phBoundaryLayer = L.geoJSON(data, {
            style: {
                fillColor: 'transparent',
                color: '#333',
                weight: 2,
                opacity: 0.6
            }
        }).addTo(map);
        console.log('✓ Philippines boundary loaded');
    })
    .catch(error => {
        console.warn('Philippines boundary not loaded:', error.message);
    });

// LOAD CONTOURS (GeoJSON)
fetch('data/contours.geojson')
    .then(response => {
        if (!response.ok) {
            throw new Error('Contours file not found');
        }
        return response.json();
    })
    .then(data => {
        contoursLayer = L.geoJSON(data, {
            style: {
                color: '#ff7800',
                weight: 1.5,
                opacity: 0.7
            },
            onEachFeature: function(feature, layer) {
                // Check different possible property names for PGA value
                const pgaValue = feature.properties.pga || 
                               feature.properties.PGA || 
                               feature.properties.ELEV ||
                               feature.properties.value;
                
                if (pgaValue) {
                    layer.bindPopup(`
                        <strong>PGA Contour</strong><br>
                        Value: ${pgaValue} cm/s²
                    `);
                }
            }
        }).addTo(map);
        
        console.log('✓ Contours loaded');
    })
    .catch(error => {
        console.warn('Contours not loaded:', error.message);
    });

// LOAD EPICENTER (GeoJSON)
fetch('data/epicenter.geojson')
    .then(response => {
        if (!response.ok) {
            throw new Error('Epicenter file not found');
        }
        return response.json();
    })
    .then(data => {
        epicenterLayer = L.geoJSON(data, {
            pointToMarker: function(feature, latlng) {
                return L.marker(latlng, {
                    icon: L.divIcon({
                        className: 'epicenter-marker',
                        html: '<div style="font-size: 24px;">⭐</div>',
                        iconSize: [30, 30],
                        iconAnchor: [15, 15]
                    })
                });
            },
            onEachFeature: function(feature, layer) {
                layer.bindPopup(`
                    <div style="text-align: center;">
                        <h3 style="color: #d73027; margin-bottom: 5px;">⭐ M 7.1 Earthquake</h3>
                        <p style="margin: 5px 0;"><strong>Location:</strong> Calapan, Mindoro</p>
                        <p style="margin: 5px 0;"><strong>Coordinates:</strong> 13.4251°N, 121.0220°E</p>
                    </div>
                `);
            }
        }).addTo(map);
        
        console.log('✓ Epicenter loaded');
    })
    .catch(error => {
        console.warn('Epicenter not loaded:', error.message);
        
        // Fallback: Create manual epicenter if file not found
        epicenterLayer = L.marker([13.4251, 121.0220], {
            icon: L.divIcon({
                className: 'epicenter-marker',
                html: '<div style="font-size: 24px;">⭐</div>',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        }).addTo(map);
        
        epicenterLayer.bindPopup(`
            <div style="text-align: center;">
                <h3 style="color: #d73027; margin-bottom: 5px;">⭐ M 7.1 Earthquake</h3>
                <p style="margin: 5px 0;"><strong>Location:</strong> Calapan, Mindoro</p>
                <p style="margin: 5px 0;"><strong>Coordinates:</strong> 13.4251°N, 121.0220°E</p>
            </div>
        `);
    });

// ============================================
// LOAD PGA RASTER (GeoTIFF)
// Note: This requires georaster and georaster-layer-for-leaflet libraries
// Add these to your HTML before map.js:
// <script src="https://unpkg.com/georaster"></script>
// <script src="https://unpkg.com/georaster-layer-for-leaflet"></script>
// ============================================

// Check if georaster libraries are loaded
if (typeof parseGeoraster !== 'undefined' && typeof GeoRasterLayer !== 'undefined') {
    fetch('data/pgamasked.tif')
        .then(response => {
            if (!response.ok) {
                throw new Error('PGA raster file not found');
            }
            return response.arrayBuffer();
        })
        .then(arrayBuffer => {
            parseGeoraster(arrayBuffer).then(georaster => {
                console.log('Georaster info:', georaster);
                
                pgaRasterLayer = new GeoRasterLayer({
                    georaster: georaster,
                    opacity: 0.7,
                    pixelValuesToColorFn: values => {
                        const pga = values[0];
                        
                        // Handle no data
                        if (pga === null || pga === undefined || pga === 0) {
                            return null; // Transparent
                        }
                        
                        // Color scale based on PGA values (cm/s²)
                        if (pga > 200) return 'rgba(103, 0, 31, 0.8)';    // Dark red (Extreme)
                        if (pga > 150) return 'rgba(178, 24, 43, 0.8)';   // Red (Very High)
                        if (pga > 100) return 'rgba(214, 96, 77, 0.8)';   // Orange-red (High)
                        if (pga > 75) return 'rgba(244, 165, 130, 0.8)';  // Orange (Moderate-High)
                        if (pga > 50) return 'rgba(253, 219, 199, 0.7)';  // Light orange (Moderate)
                        if (pga > 25) return 'rgba(209, 229, 240, 0.7)';  // Light blue (Low)
                        if (pga > 10) return 'rgba(146, 197, 222, 0.7)';  // Blue (Very Low)
                        return 'rgba(67, 147, 195, 0.6)';                  // Dark blue (Minimal)
                    },
                    resolution: 256
                });
                
                pgaRasterLayer.addTo(map);
                console.log('✓ PGA raster loaded');
                
                // Update info panel
                document.getElementById('map-info').innerHTML = `
                    <p style="color: #4CAF50; font-weight: bold;">✓ PGA data loaded successfully</p>
                    <p style="font-size: 12px; margin-top: 5px;">Click anywhere to query PGA values</p>
                `;
            });
        })
        .catch(error => {
            console.warn('PGA raster not loaded:', error.message);
            document.getElementById('map-info').innerHTML = `
                <p style="color: #ff9800;">⚠ PGA raster not found</p>
                <p style="font-size: 12px;">Make sure pgamasked.tif is in data/ folder</p>
            `;
        });
} else {
    console.warn('Georaster libraries not loaded. Add these to your HTML:');
    console.warn('<script src="https://unpkg.com/georaster"></script>');
    console.warn('<script src="https://unpkg.com/georaster-layer-for-leaflet"></script>');
    
    document.getElementById('map-info').innerHTML = `
        <p style="color: #f44336;">✗ Georaster libraries missing</p>
        <p style="font-size: 12px;">See console for instructions</p>
    `;
}

// ENHANCED LAYER CONTROL
setTimeout(() => {
    const baseMaps = {
        "🗺️ Terrain": terrainLayer,
        "🌍 OpenStreetMap": osmLayer
    };
    
    const overlayMaps = {};
    
    // Add layers that are loaded
    if (pgaRasterLayer) overlayMaps["📊 PGA Intensity"] = pgaRasterLayer;
    if (contoursLayer) overlayMaps["📈 Contours"] = contoursLayer;
    if (phBoundaryLayer) overlayMaps["🗾 Philippines Border"] = phBoundaryLayer;
    if (epicenterLayer) overlayMaps["⭐ Epicenter"] = epicenterLayer;
    
    L.control.layers(baseMaps, overlayMaps, {
        position: 'topright',
        collapsed: false  // Keep expanded by default
    }).addTo(map);
    
    console.log('✓ Layer controls initialized');
}, 2000); // Wait 2 seconds for all layers to load

// LEGEND
const legend = L.control({position: 'bottomright'});

legend.onAdd = function(map) {
    const div = L.DomUtil.create('div', 'legend');
    div.innerHTML = `
        <h4>PGA Scale (cm/s²)</h4>
        <i style="background: #67001f"></i> <span>> 200 (Extreme)</span><br>
        <i style="background: #b2182b"></i> <span>150-200 (Very High)</span><br>
        <i style="background: #d6604d"></i> <span>100-150 (High)</span><br>
        <i style="background: #f4a582"></i> <span>75-100 (Moderate)</span><br>
        <i style="background: #fddbc7"></i> <span>50-75 (Low)</span><br>
        <i style="background: #d1e5f0"></i> <span>25-50 (Very Low)</span><br>
        <i style="background: #92c5de"></i> <span>10-25 (Minimal)</span><br>
        <i style="background: #4393c3"></i> <span>< 10 (Negligible)</span>
    `;
    return div;
};

legend.addTo(map);

// INITIALIZATION MESSAGE
console.log('🗺️ SeiScanPH Map initialized!');
console.log('📍 Epicenter: 13.4251°N, 121.0220°E (Calapan)');
console.log('📊 Loading QGIS exports...');
console.log('');
console.log('Files expected:');
console.log('  - data/ph_boundary.geojson');
console.log('  - data/contours.geojson');
console.log('  - data/epicenter.geojson');
console.log('  - data/pgamasked.tif');
console.log('');
console.log('For full raster support, add to HTML:');
console.log('<script src="https://unpkg.com/georaster"></script>');
console.log('<script src="https://unpkg.com/georaster-layer-for-leaflet"></script>');