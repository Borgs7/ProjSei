// ============================================
// SEISCANPH - CLICK-TO-CALCULATE INTENSITY
// Phase 2: API-first with offline fallback
// ============================================

const API_BASE = 'http://localhost:8000';
let apiConnected = false;

// ============================================
// API CONNECTION CHECK
// ============================================
async function checkAPIConnection() {
    const statusEl = document.getElementById('api-status');
    const infoPanel = document.getElementById('map-info');

    try {
        const response = await fetch(`${API_BASE}/health`);
        const data = await response.json();

        if (data.status === 'healthy') {
            apiConnected = true;

            // Update top-bar status (dot + label)
            statusEl.className = 'api-status connected';
            statusEl.querySelector('.status-text').textContent = 'Live data';

            // Update panel data status (Layers tab)
            if (infoPanel) {
                const count = data.seismic_points_loaded?.toLocaleString() || '?';
                infoPanel.innerHTML = `
                    <span class="status-ok">Connected to PostGIS</span> · ${count} PGA data points.
                    Click the map or search a location.
                `;
            }
            console.log(`✓ API connected | ${data.seismic_points_loaded} points`);
        } else {
            throw new Error(data.error || 'Unhealthy');
        }
    } catch (error) {
        apiConnected = false;

        statusEl.className = 'api-status disconnected';
        statusEl.querySelector('.status-text').textContent = 'Offline data';

        if (infoPanel) {
            infoPanel.innerHTML = `
                <span class="status-warn">Offline data</span> · calculations use the bundled PGA points.
            `;
        }
        console.info('API offline. To use live data, run the backend: uvicorn main:app --reload');
        loadStaticPGAData();
    }
}

// ============================================
// FALLBACK: Static GeoJSON
// ============================================
let pgaPointsData = [];

function loadStaticPGAData() {
    fetch('data/pga_points.geojson')
        .then(r => { if (!r.ok) throw new Error('Not found'); return r.json(); })
        .then(data => {
            pgaPointsData = data.features.map(f => ({
                lat: f.properties.latitude,
                lon: f.properties.longitude,
                pga: f.properties.pga_cm_s2
            }));
            console.log(`✓ Fallback: ${pgaPointsData.length} static points`);
        })
        .catch(err => console.warn('Static data not available:', err.message));
}

// ============================================
// OFFLINE CALC FUNCTIONS
// ============================================
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function offlineCalculate(clickLat, clickLon) {
    if (pgaPointsData.length === 0) return null;
    const sorted = pgaPointsData
        .map(p => ({ ...p, dist: haversineDistance(clickLat, clickLon, p.lat, p.lon) }))
        .sort((a, b) => a.dist - b.dist).slice(0, 8);
    if (sorted[0].dist > 500) return null;
    let num = 0, den = 0;
    sorted.forEach(p => {
        if (p.dist < 0.001) { num = p.pga; den = 1; return; }
        const w = 1 / (p.dist ** 2);
        num += w * p.pga; den += w;
    });
    return den > 0 ? num / den : null;
}

function pgaToMMI(pga) {
    if (!pga || pga <= 0) return 1;
    const logPga = Math.log10(pga);
    return Math.max(1, Math.min(10, Math.round(
        logPga <= 1.82 ? 2.20 * logPga + 1.00 : 3.66 * logPga - 1.66
    )));
}

function getIntensityDescription(mmi) {
    const d = {
        1:  { level: "I — Not Felt",      color: "#FFFFFF", textColor: "#333",  description: "Not felt except by very few under especially favorable conditions." },
        2:  { level: "II — Weak",          color: "#BFCCFF", textColor: "#333",  description: "Felt only by few persons at rest, especially on upper floors." },
        3:  { level: "III — Weak",         color: "#9FD9FF", textColor: "#333",  description: "Felt quite noticeably indoors. Standing motor cars may rock slightly." },
        4:  { level: "IV — Light",         color: "#7FFFE6", textColor: "#333",  description: "Felt indoors by many, outdoors by few. Dishes and windows disturbed." },
        5:  { level: "V — Moderate",       color: "#7FFF7F", textColor: "#333",  description: "Felt by nearly everyone. Some dishes and windows broken. Unstable objects overturned." },
        6:  { level: "VI — Strong",        color: "#FFFF00", textColor: "#333",  description: "Felt by all. Many frightened. Some heavy furniture moved. Slight structural damage." },
        7:  { level: "VII — Very Strong",  color: "#FFD27F", textColor: "#333",  description: "Most people alarmed. Considerable damage to poorly built structures." },
        8:  { level: "VIII — Severe",      color: "#FFA500", textColor: "white", description: "Considerable damage in ordinary buildings. Fall of chimneys and monuments." },
        9:  { level: "IX — Violent",       color: "#FF7F7F", textColor: "white", description: "Considerable damage in specially designed structures. Ground cracked conspicuously." },
        10: { level: "X — Extreme",        color: "#FF0000", textColor: "white", description: "Most masonry and frame structures destroyed. Ground badly cracked." }
    };
    return d[mmi] || d[5];
}

// ============================================
// MAIN CLICK HANDLER
// ============================================
setTimeout(() => {
    if (typeof map === 'undefined') {
        console.error('Map not initialized');
        return;
    }

    checkAPIConnection();
    // NOTE: do NOT call map.off('click') here — it would remove the
    // NearestFault handler registered in map.js, disabling the dashed
    // connector. One click is meant to trigger BOTH features.

    map.on('click', async function (e) {
        const clickLat = e.latlng.lat;
        const clickLon = e.latlng.lng;

        // Results card shows "Calculating…" (nearest-fault.js may already have
        // opened it for this same click — open() only resets once per click)
        ResultsCard.open(e.latlng);

        let popupData = null;
        let source = 'offline';

        // TRY API FIRST
        if (apiConnected) {
            try {
                const url = `${API_BASE}/api/calculate/intensity?lat=${clickLat}&lon=${clickLon}&num_points=8`;
                const response = await fetch(url);
                const data = await response.json();

                if (data.status === 'success') {
                    popupData = data;
                    source = 'api';
                } else if (data.status === 'outside_coverage') {
                    ResultsCard.showMessage(e.latlng, 'Outside the study area',
                        data.message || 'No shaking data is available for this location.',
                        data.distance_from_epicenter_km);
                    return;
                }
            } catch (err) {
                console.warn('API failed, using fallback:', err.message);
            }
        }

        // OFFLINE FALLBACK
        if (!popupData && pgaPointsData.length > 0) {
            const pga = offlineCalculate(clickLat, clickLon);
            if (pga !== null) {
                const mmi = pgaToMMI(pga);
                const info = getIntensityDescription(mmi);
                popupData = {
                    location: { lat: clickLat.toFixed(4), lon: clickLon.toFixed(4) },
                    pga_value: pga.toFixed(2),
                    mmi: mmi,
                    intensity_level: info.level,
                    description: info.description,
                    color: info.color,
                    text_color: info.textColor,
                    distance_from_epicenter_km: haversineDistance(clickLat, clickLon, 13.4251, 121.0220).toFixed(1)
                };
                source = 'offline';
            }
        }

        // NO DATA (shown in the same card)
        if (!popupData) {
            const epicenterKm = haversineDistance(clickLat, clickLon, 13.4251, 121.0220);
            if (apiConnected || pgaPointsData.length > 0) {
                ResultsCard.showMessage(e.latlng, 'Outside the study area',
                    'This spot is outside the area covered by the scenario data.', epicenterKm);
            } else {
                ResultsCard.showMessage(e.latlng, 'No data yet',
                    'The calculation server is offline and the bundled PGA data hasn\'t finished loading. Try again in a moment.',
                    epicenterKm);
            }
            return;
        }

        // SHOW RESULT in the card (the clicked-point marker is kept by ResultsCard
        // until the card is closed or the map is clicked again)
        ResultsCard.showResult(e.latlng, popupData, source);

        console.log(`[${source.toUpperCase()}] ${clickLat.toFixed(4)}, ${clickLon.toFixed(4)} → PGA: ${popupData.pga_value} | ${popupData.intensity_level}`);
    });

    console.log('✓ SeiScanPH click calculator ready');
}, 100);