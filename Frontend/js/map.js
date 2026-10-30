// ============================================
// SEISCANPH - HAZARD MAP SETUP (map.html)
// Creates the map, base maps and data layers. Each data layer registers
// with the side panel (js/layer-panel.js) the moment it finishes loading,
// or is marked "Unavailable" if it fails — so slow layers never go missing.
// ============================================

// Study area / initial view (Calapan scenario). Also used by "Reset view".
const STUDY_VIEW = { center: [13.4251, 121.0220], zoom: 9 };

const map = L.map('map', { zoomControl: false })   // zoom buttons are custom (js/map-ui.js)
    .setView(STUDY_VIEW.center, STUDY_VIEW.zoom);
L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

NearestFault.init(map, 'http://localhost:8000');
ResultsCard.init(map);
LayerPanel.init(map);

// ============================================
// BASE MAPS — all keyless (work on GitHub Pages), with required attribution
// ============================================
const baseLayers = {
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }),
    terrain: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
        subdomains: 'abc',
        maxZoom: 17
    }),
    streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    })
};
LayerPanel.setBasemaps(baseLayers, 'light');

// LAYER REFERENCES (kept as globals; each is registered with the panel once loaded)
let pgaRasterLayer = null;
let contoursLayer = null;
let phBoundaryLayer = null;
let epicenterLayer = null;
let faultsLayer = null;
let gebcoLayer = null;
let researchFaultsLayer = null;
let bacudLayer = null;

// LOAD PHILIPPINES BOUNDARY (GeoJSON) — on by default
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
            },
            interactive: false
        }).addTo(map);
        LayerPanel.register('boundary', phBoundaryLayer);
        console.log('✓ Philippines boundary loaded');
    })
    .catch(error => {
        console.warn('Philippines boundary not loaded:', error.message);
        LayerPanel.fail('boundary', error.message);
    });

// LOAD CONTOURS (GeoJSON) — off by default
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
                        <div class="map-popup"><h3>PGA contour</h3><p>Value: ${pgaValue} cm/s²</p></div>
                    `);
                }
            }
        });
        LayerPanel.register('contours', contoursLayer);
        console.log('✓ Contours loaded');
    })
    .catch(error => {
        console.warn('Contours not loaded:', error.message);
        LayerPanel.fail('contours', error.message);
    });

// LOAD EPICENTER (GeoJSON) — on by default
const EPICENTER_POPUP = `
    <div class="map-popup">
        <h3>M 7.1 Earthquake</h3>
        <p><strong>Location:</strong> Calapan, Mindoro</p>
        <p><strong>Coordinates:</strong> 13.4251°N, 121.0220°E</p>
    </div>
`;

function epicenterMarker(latlng) {
    return L.marker(latlng, {
        icon: L.divIcon({
            className: 'epicenter-marker',
            html: '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z" fill="#B4111A" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        }),
        alt: 'Epicenter'
    });
}

fetch('data/epicenter.geojson')
    .then(response => {
        if (!response.ok) {
            throw new Error('Epicenter file not found');
        }
        return response.json();
    })
    .then(data => {
        epicenterLayer = L.geoJSON(data, {
            pointToLayer: (feature, latlng) => epicenterMarker(latlng),   // was "pointToMarker" (not a Leaflet option), so the star never showed
            onEachFeature: (feature, layer) => layer.bindPopup(EPICENTER_POPUP)
        }).addTo(map);
        LayerPanel.register('epicenter', epicenterLayer);
        console.log('✓ Epicenter loaded');
    })
    .catch(error => {
        console.warn('Epicenter not loaded:', error.message);

        // Fallback: create the epicenter marker manually if the file isn't found
        epicenterLayer = epicenterMarker(STUDY_VIEW.center).bindPopup(EPICENTER_POPUP).addTo(map);
        LayerPanel.register('epicenter', epicenterLayer);
    });

// LOAD ACTIVE FAULTS (GeoJSON via ActiveFaults helper) — on by default
ActiveFaults.fromStatic('data/active_faults_calapan.geojson')
    .then(layer => {
        faultsLayer = layer;
        faultsLayer.addTo(map);
        LayerPanel.register('faults', faultsLayer);
        NearestFault.useLayer(faultsLayer);   // offline nearest-fault estimate
        console.log('✓ Active faults loaded');
    })
    .catch(error => {
        console.warn('Active faults not loaded:', error.message);
        LayerPanel.fail('faults', error.message);
    });

// LOAD RESEARCH FAULTS (static GeoJSON — purple, distinct from PHIVOLCS) — off by default
ResearchFaults.fromStatic('data/research_faults.geojson', {
    style: { color: '#7b3fbf', dashArray: '6,4', title: 'Research fault trace' }
})
    .then(layer => {
        researchFaultsLayer = layer;
        LayerPanel.register('research', researchFaultsLayer);
        console.log('✓ Research faults loaded');
    })
    .catch(error => {
        console.warn('Research faults not loaded:', error.message);
        LayerPanel.fail('research', error.message);
    });

// LOAD BACUD 1997 TECTONIC MAP (Sibuyan Sea, mostly offshore) — off by default
ResearchFaults.fromStatic('data/bacud_tectonic.geojson', {
    style: { color: '#9c6ad6', dashArray: '1,5', title: 'Bacud (1997) tectonic map' }
})
    .then(layer => {
        bacudLayer = layer;
        LayerPanel.register('bacud', bacudLayer);
        console.log('✓ Bacud tectonic map loaded');
    })
    .catch(error => {
        console.warn('Bacud tectonic map not loaded:', error.message);
        LayerPanel.fail('bacud', error.message);
    });

// LOAD GEBCO BATHYMETRY/TERRAIN (GeoTIFF) — on by default
GebcoTerrain.load('data/gebco_calapan.tif')
    .then(layer => {
        gebcoLayer = layer;
        gebcoLayer.addTo(map);
        LayerPanel.register('gebco', gebcoLayer);
        console.log('✓ GEBCO terrain loaded');
    })
    .catch(error => {
        console.warn('GEBCO terrain not loaded:', error.message);
        LayerPanel.fail('gebco', error.message);
    });

// ============================================
// LOAD PGA RASTER (GeoTIFF) — "Shaking intensity", off by default
// Needs the georaster + georaster-layer-for-leaflet scripts (loaded in map.html).
// ============================================
if (typeof parseGeoraster !== 'undefined' && typeof GeoRasterLayer !== 'undefined') {
    fetch('data/pgamasked.tif')
        .then(response => {
            if (!response.ok) {
                throw new Error('PGA raster file not found');
            }
            return response.arrayBuffer();
        })
        .then(arrayBuffer => parseGeoraster(arrayBuffer))
        .then(georaster => {
            const noData = georaster.noDataValue;
            pgaRasterLayer = new GeoRasterLayer({
                georaster: georaster,
                opacity: 0.7,
                pixelValuesToColorFn: values => {
                    const pga = values[0];

                    // Handle no data
                    if (pga === null || pga === undefined || pga === 0 || pga === noData || isNaN(pga)) {
                        return null; // Transparent
                    }

                    // Colour by MMI, using the SAME PGA → MMI conversion (Wald et al. 1999)
                    // and MMI colours as the click result (pgaToMMI / getIntensityDescription
                    // in click-calculator.js — loaded before any tile is drawn).
                    return getIntensityDescription(pgaToMMI(pga)).color;
                },
                resolution: 256
            });
            LayerPanel.register('pga', pgaRasterLayer);
            console.log('✓ PGA raster loaded');
        })
        .catch(error => {
            console.warn('PGA raster not loaded:', error.message);
            LayerPanel.fail('pga', error.message);
        });
} else {
    console.warn('Georaster libraries not loaded — PGA raster unavailable.');
    LayerPanel.fail('pga', 'Georaster libraries not loaded');
}

console.log('🗺️ SeiScanPH map initialized — epicenter 13.4251°N, 121.0220°E (Calapan)');
