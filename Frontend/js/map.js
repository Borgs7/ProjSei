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
// BASE MAPS — all label-free, with required attribution. Place names are drawn
// by js/place-labels.js so they can be filtered by zoom.
//   Light / Streets: CARTO (needs a CARTO Basemaps API key since 25 Sept 2026)
//   Terrain: Esri World Terrain Base (keyless). Esri lists it to zoom 13, but over the
//            Philippines zoom 10+ tiles only say "Map data not yet available", so zoom 9
//            tiles are enlarged beyond that (maxNativeZoom).
// ============================================
const CARTO_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// CARTO Basemaps API keys (dashboard.basemaps.carto.com). Public on purpose: each key only
// works on the hosts it is restricted to there. A CARTO key can't list localhost AND a
// public site, hence two keys.
const CARTO_KEYS = {
    live: 'cb1_55qb_1_9c871cd9c82d655de91c87e9',    // borgs7.github.io
    local: 'cb1_55qb_2_23113bbf60ff367d1a2efeeb'    // localhost, 127.0.0.1 (Live Server, python -m http.server)
};
const CARTO_KEY = ['localhost', '127.0.0.1'].includes(location.hostname) ? CARTO_KEYS.local : CARTO_KEYS.live;
const cartoTiles = (style) => `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`;
const ESRI_SERVICES = 'https://server.arcgisonline.com/ArcGIS/rest/services/';

const baseLayers = {
    light: L.tileLayer(cartoTiles('light_nolabels'), {
        attribution: CARTO_ATTRIBUTION,
        subdomains: 'abcd',
        maxZoom: 20
    }),
    terrain: L.tileLayer(ESRI_SERVICES + 'World_Terrain_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Sources: Esri, USGS, NOAA',
        maxNativeZoom: 9,
        maxZoom: 17
    }),
    streets: L.tileLayer(cartoTiles('rastertiles/voyager_nolabels'), {
        attribution: CARTO_ATTRIBUTION,
        subdomains: 'abcd',
        maxZoom: 20
    })
};

// Detailed names-only tiles, shown by place-labels.js at zoom 12+ over each base map.
// NO minZoom here on purpose: Leaflet treats a layer's minZoom as a limit for the whole
// map (the map jumps to 12 on a base-map switch and can't zoom out). place-labels.js
// adds/removes these layers itself based on the current zoom.
const labelTiles = {
    terrain: L.tileLayer(ESRI_SERVICES + 'Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Labels &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community',
        maxZoom: 17,
        pane: 'placeLabels'
    }),
    light: L.tileLayer(cartoTiles('light_only_labels'), {
        attribution: CARTO_ATTRIBUTION,
        subdomains: 'abcd',
        maxZoom: 20,
        pane: 'placeLabels'
    }),
    streets: L.tileLayer(cartoTiles('rastertiles/voyager_only_labels'), {
        attribution: CARTO_ATTRIBUTION,
        subdomains: 'abcd',
        maxZoom: 20,
        pane: 'placeLabels'
    })
};

// Must run before setBasemaps(): it creates the label pane, and setBase() reports to it
PlaceLabels.init(map, { url: 'data/place_labels.geojson', labelTiles: labelTiles });
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
