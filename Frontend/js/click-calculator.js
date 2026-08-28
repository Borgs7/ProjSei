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

            // Update header status
            statusEl.className = 'api-status connected';
            statusEl.querySelector('.status-text').textContent = 'API Online';

            // Update sidebar info
            if (infoPanel) {
                const count = data.seismic_points_loaded?.toLocaleString() || '?';
                infoPanel.innerHTML = `
                    <p class="status-connected">✓ Connected to PostGIS</p>
                    <p class="status-points">${count} PGA data points loaded</p>
                    <p style="font-size: 11px; color: var(--accent); margin-top: 6px;">Click the map or search a location</p>
                `;
            }
            console.log(`✓ API connected | ${data.seismic_points_loaded} points`);
        } else {
            throw new Error(data.error || 'Unhealthy');
        }
    } catch (error) {
        apiConnected = false;

        statusEl.className = 'api-status disconnected';
        statusEl.querySelector('.status-text').textContent = 'API Offline';

        if (infoPanel) {
            infoPanel.innerHTML = `
                <p style="color: var(--warning); font-weight: 600;">⚠ API Offline</p>
                <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                    Run: <code style="background: var(--bg-primary); padding: 1px 5px; border-radius: 3px;">uvicorn main:app --reload</code>
                </p>
            `;
        }
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
// POPUP BUILDER
// ============================================
function buildPopupHTML(data, source = 'api') {
    const color = data.color || '#3b82f6';
    const textColor = data.text_color || data.textColor || '#333';

    return `
        <div style="min-width: 280px; font-family: 'DM Sans', sans-serif;">
            <div style="background: ${color}; color: ${textColor}; padding: 12px; margin: -10px -10px 12px -10px; border-radius: 8px 8px 0 0; text-align: center;">
                <h3 style="margin: 0; font-size: 18px; font-weight: 700;">${data.intensity_level}</h3>
            </div>
            <table style="width: 100%; font-size: 13px; margin-bottom: 12px; border-collapse: collapse;">
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 6px 0; color: #666; font-weight: 500;">Location</td>
                    <td style="padding: 6px 0; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 12px;">${data.location.lat}°N, ${data.location.lon}°E</td>
                </tr>
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 6px 0; color: #666; font-weight: 500;">PGA Value</td>
                    <td style="padding: 6px 0; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 12px;">${data.pga_value} cm/s²</td>
                </tr>
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 6px 0; color: #666; font-weight: 500;">Epicenter Distance</td>
                    <td style="padding: 6px 0; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 12px;">${data.distance_from_epicenter_km} km</td>
                </tr>
                <tr>
                    <td style="padding: 6px 0; color: #666; font-weight: 500;">Source</td>
                    <td style="padding: 6px 0; text-align: right; font-size: 11px; color: ${source === 'api' ? '#22c55e' : '#f59e0b'};">
                        ${source === 'api' ? '✓ PostGIS API' : '⚠ Offline'}
                    </td>
                </tr>
            </table>
            <div style="background: #f8fafc; padding: 10px; border-radius: 6px; border-left: 3px solid ${color};">
                <p style="font-size: 12px; color: #555; margin: 0; line-height: 1.5;">
                    <strong>Expected Effects:</strong><br>${data.description}
                </p>
            </div>
        </div>
    `;
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

        // Loading popup
        L.popup({ maxWidth: 320, className: 'intensity-popup' })
            .setLatLng(e.latlng)
            .setContent(`
                <div style="padding: 20px; text-align: center; min-width: 200px; font-family: 'DM Sans', sans-serif;">
                    <div style="width: 24px; height: 24px; border: 3px solid #3b82f6; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 10px;"></div>
                    <p style="color: #333; font-weight: 600; margin: 0;">Calculating intensity...</p>
                    <p style="font-size: 11px; color: #999; margin: 4px 0 0;">
                        ${apiConnected ? 'Querying PostGIS' : 'Offline mode'}
                    </p>
                </div>
                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
            `)
            .openOn(map);

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
                    L.popup({ maxWidth: 320 }).setLatLng(e.latlng)
                        .setContent(`
                            <div style="padding: 20px; text-align: center; min-width: 250px; font-family: 'DM Sans', sans-serif;">
                                <div style="font-size: 32px; margin-bottom: 8px;">📍</div>
                                <h3 style="color: #666; margin: 0 0 8px; font-size: 15px;">Outside Coverage Area</h3>
                                <p style="font-size: 12px; color: #999; margin: 0; line-height: 1.5;">
                                    ${data.message || 'No data available for this location'}
                                    ${data.distance_from_epicenter_km ? '<br>Epicenter distance: ' + data.distance_from_epicenter_km + ' km' : ''}
                                </p>
                            </div>
                        `)
                        .openOn(map);
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

        // NO DATA
        if (!popupData) {
            L.popup({ maxWidth: 320 }).setLatLng(e.latlng)
                .setContent(`
                    <div style="padding: 20px; text-align: center; font-family: 'DM Sans', sans-serif;">
                        <div style="font-size: 32px; margin-bottom: 8px;">🚫</div>
                        <p style="color: #ef4444; font-weight: 600; margin: 0;">No Data Available</p>
                        <p style="font-size: 11px; color: #999; margin-top: 4px;">
                            ${apiConnected ? 'Outside coverage area' : 'API offline — no static data loaded'}
                        </p>
                    </div>
                `).openOn(map);
            return;
        }

        // SHOW RESULT
        L.popup({ maxWidth: 340, className: 'intensity-popup' })
            .setLatLng(e.latlng)
            .setContent(buildPopupHTML(popupData, source))
            .openOn(map);

        // Temporary marker
        const clickMarker = L.circleMarker(e.latlng, {
            radius: 8, fillColor: popupData.color || '#3b82f6',
            color: '#fff', weight: 2, opacity: 0.9, fillOpacity: 0.7
        }).addTo(map);
        setTimeout(() => map.removeLayer(clickMarker), 5000);

        console.log(`[${source.toUpperCase()}] ${clickLat.toFixed(4)}, ${clickLon.toFixed(4)} → PGA: ${popupData.pga_value} | ${popupData.intensity_level}`);
    });

    console.log('✓ SeiScanPH click calculator ready');
}, 100);