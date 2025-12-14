// SEISCANPH - CLICK-TO-CALCULATE INTENSITY

// Store PGA points data globally
let pgaPointsData = [];

// Epicenter coordinates (Calapan M7.1) 1 for now
const EPICENTER = {
    lat: 13.4251,
    lon: 121.0220,
    magnitude: 7.1,
    depth: 10 // km
};

// PGA POINTS DATA
fetch('data/pga_points.geojson')
    .then(response => {
        if (!response.ok) {
            throw new Error('PGA points file not found');
        }
        return response.json();
    })
    .then(data => {
        // Extract coordinates and PGA values
        pgaPointsData = data.features.map(feature => ({
            lat: feature.properties.latitude,
            lon: feature.properties.longitude,
            pga: feature.properties.pga_cm_s2
        }));
        
        console.log(`✓ Loaded ${pgaPointsData.length} PGA data points`);
        
        // Info panel
        const infoPanel = document.getElementById('map-info');
        if (infoPanel) {
            infoPanel.innerHTML = `
                <p style="color: #4CAF50; font-weight: bold;">✓ ${pgaPointsData.length.toLocaleString()} PGA points loaded</p>
                <p style="font-size: 12px; margin-top: 5px;">Click anywhere to calculate intensity</p>
            `;
        }
    })
    .catch(error => {
        console.error('❌ Failed to load PGA points:', error);
        const infoPanel = document.getElementById('map-info');
        if (infoPanel) {
            infoPanel.innerHTML = `
                <p style="color: #f44336;">✗ PGA points not loaded</p>
                <p style="font-size: 12px;">${error.message}</p>
            `;
        }
    });

// UTILITY FUNCTIONS AND PARAMETERS

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in kilometers
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Inverse Distance Weighting interpolation
 * @param {number} clickLat - Clicked latitude
 * @param {number} clickLon - Clicked longitude
 * @param {Array} nearestPoints - Array of nearest PGA points
 * @param {number} power - IDW power parameter (default: 2)
 * @returns {number} Interpolated PGA value
 */
function interpolateIDW(clickLat, clickLon, nearestPoints, power = 2) {
    if (nearestPoints.length === 0) return null;
    
    // If click is very close to an existing point (< 100m), return that value
    const veryClosePoint = nearestPoints.find(p => 
        haversineDistance(clickLat, clickLon, p.lat, p.lon) < 0.1
    );
    if (veryClosePoint) return veryClosePoint.pga;
    
    let numerator = 0;
    let denominator = 0;
    
    nearestPoints.forEach(point => {
        const distance = haversineDistance(clickLat, clickLon, point.lat, point.lon);
        if (distance < 0.001) return point.pga;
        
        const weight = 1 / Math.pow(distance, power);
        numerator += weight * point.pga;
        denominator += weight;
    });
    
    return denominator > 0 ? numerator / denominator : null;
}

/**
 * Find N nearest points to clicked location
 * @param {number} clickLat - Clicked latitude
 * @param {number} clickLon - Clicked longitude
 * @param {Array} allPoints - All PGA points
 * @param {number} n - Number of nearest points to find
 * @returns {Array} Array of nearest points
 */
function findNearestPoints(clickLat, clickLon, allPoints, n = 8) {
    const pointsWithDistance = allPoints.map(point => ({
        ...point,
        distance: haversineDistance(clickLat, clickLon, point.lat, point.lon)
    }));
    
    pointsWithDistance.sort((a, b) => a.distance - b.distance);
    return pointsWithDistance.slice(0, n);
}

/**
 * Convert PGA (cm/s²) to MMI (Modified Mercalli Intensity)
 * Based on Wald et al. (1999) - Official USGS ShakeMap piecewise relationship
 * Reference: "Relationships between Peak Ground Acceleration, Peak Ground Velocity, 
 *             and Modified Mercalli Intensity in California"
 * @param {number} pga - Peak Ground Acceleration in cm/s² (Gal)
 * @returns {number} MMI intensity (1-10)
 */
function pgaToMMI(pga) {
    if (!pga || pga <= 0) return 1;
    
    // Log10 of PGA in cm/s²
    const logPga = Math.log10(pga);
    let mmi;
    
    // Piecewise function with transition at PGA ≈ 66.5 cm/s² (log10 ≈ 1.82)
    // This corresponds to MMI V
    if (logPga <= 1.82) { 
        // Low Intensity (MMI I-IV): More gradual increase
        mmi = 2.20 * logPga + 1.00;
    } else {
        // High Intensity (MMI V-X): Steeper increase
        mmi = 3.66 * logPga - 1.66;
    }
    
    // Round and clip to standard MMI range (I to X)
    const mmiRounded = Math.round(mmi);
    return Math.max(1, Math.min(10, mmiRounded));
}

/**
 * Get intensity description and color
 * @param {number} mmi - MMI intensity value
 * @returns {Object} Object containing level, description, and color
 */
function getIntensityDescription(mmi) {
    const descriptions = {
        1: { 
            level: "I - Not Felt", 
            description: "Not felt except by very few under especially favorable conditions.", 
            color: "#FFFFFF",
            textColor: "#333"
        },
        2: { 
            level: "II - Weak", 
            description: "Felt only by few persons at rest, especially on upper floors.", 
            color: "#BFCCFF",
            textColor: "#333"
        },
        3: { 
            level: "III - Weak", 
            description: "Felt quite noticeably indoors. Standing motor cars may rock slightly.", 
            color: "#9FD9FF",
            textColor: "#333"
        },
        4: { 
            level: "IV - Light", 
            description: "Felt indoors by many, outdoors by few. Dishes and windows disturbed.", 
            color: "#7FFFE6",
            textColor: "#333"
        },
        5: { 
            level: "V - Moderate", 
            description: "Felt by nearly everyone. Some dishes and windows broken. Unstable objects overturned.", 
            color: "#7FFF7F",
            textColor: "#333"
        },
        6: { 
            level: "VI - Strong", 
            description: "Felt by all. Many frightened. Some heavy furniture moved. Slight structural damage.", 
            color: "#FFFF00",
            textColor: "#333"
        },
        7: { 
            level: "VII - Very Strong", 
            description: "Most people alarmed. Considerable damage to poorly built structures. Negligible in good buildings.", 
            color: "#FFD27F",
            textColor: "#333"
        },
        8: { 
            level: "VIII - Severe", 
            description: "Considerable damage in ordinary buildings. Great in poorly built structures. Fall of chimneys and monuments.", 
            color: "#FFA500",
            textColor: "white"
        },
        9: { 
            level: "IX - Violent", 
            description: "Considerable damage in specially designed structures. Buildings shifted off foundations. Ground cracked conspicuously.", 
            color: "#FF7F7F",
            textColor: "white"
        },
        10: { 
            level: "X - Extreme", 
            description: "Most masonry and frame structures destroyed. Ground badly cracked. Large landslides.", 
            color: "#FF0000",
            textColor: "white"
        }
    };
    
    return descriptions[mmi] || descriptions[5];
}

// MAIN CLICK EVENT HANDLER
setTimeout(() => {
    if (typeof map === 'undefined') {
        console.error('❌ Map not found! Make sure map.js is loaded before click-calculator.js');
        return;
    }

    // Remove old click handler
    map.off('click');

    // Add new click handler with intensity calculation
    map.on('click', function(e) {
        const clickLat = e.latlng.lat;
        const clickLon = e.latlng.lng;
        
        // Check if data is loaded
        if (pgaPointsData.length === 0) {
            L.popup()
                .setLatLng(e.latlng)
                .setContent(`
                    <div style="padding: 10px; text-align: center;">
                        <p style="color: #f44336; margin: 0;">⏳ Loading PGA data...</p>
                        <p style="font-size: 12px; color: #999; margin: 5px 0 0 0;">Please wait a moment</p>
                    </div>
                `)
                .openOn(map);
            return;
        }
        
        // Find nearest points
        const nearestPoints = findNearestPoints(clickLat, clickLon, pgaPointsData, 8);
        
        // Check if click is too far from data
        const nearestDistance = nearestPoints[0].distance;
        const MAX_DISTANCE = 50; // km - only interpolate within 50km of data
        
        if (nearestDistance > MAX_DISTANCE) {
            L.popup()
                .setLatLng(e.latlng)
                .setContent(`
                    <div style="padding: 15px; text-align: center; min-width: 250px;">
                        <h3 style="color: #999; margin: 0 0 10px 0;">📍 Outside Data Coverage</h3>
                        <p style="font-size: 13px; color: #666; margin: 0;">
                            No PGA data available for this location.<br>
                            <strong>Nearest data point:</strong> ${nearestDistance.toFixed(1)} km away
                        </p>
                        <p style="font-size: 12px; color: #999; margin: 10px 0 0 0; font-style: italic;">
                            This area is outside the M 7.1 Calapan<br>earthquake simulation coverage.
                        </p>
                    </div>
                `)
                .openOn(map);
            return;
        }
        
        // Interpolate PGA
        const pga = interpolateIDW(clickLat, clickLon, nearestPoints);
        
        if (pga === null) {
            L.popup()
                .setLatLng(e.latlng)
                .setContent(`
                    <div style="padding: 10px;">
                        <p style="color: #f44336;">❌ Unable to calculate PGA</p>
                        <p style="font-size: 12px; color: #666;">No nearby data points found</p>
                    </div>
                `)
                .openOn(map);
            return;
        }
        
        // Convert PGA to MMI using Wald et al. (1999)
        const mmi = pgaToMMI(pga);
        const intensityInfo = getIntensityDescription(mmi);
        
        // Calculate distance from epicenter
        const distanceKm = haversineDistance(clickLat, clickLon, EPICENTER.lat, EPICENTER.lon);
        
        // Create popup content
        const popupContent = `
            <div style="min-width: 280px; font-family: 'Segoe UI', sans-serif;">
                <div style="background: ${intensityInfo.color}; color: ${intensityInfo.textColor}; padding: 12px; margin: -10px -10px 12px -10px; border-radius: 8px 8px 0 0; text-align: center;">
                    <h3 style="margin: 0; font-size: 18px; font-weight: bold;">${intensityInfo.level}</h3>
                </div>
                
                <table style="width: 100%; font-size: 13px; margin-bottom: 12px; border-collapse: collapse;">
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 6px 0; color: #666;"><strong>📍 Location</strong></td>
                        <td style="padding: 6px 0; text-align: right;">${clickLat.toFixed(4)}°N, ${clickLon.toFixed(4)}°E</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 6px 0; color: #666;"><strong>📊 PGA Value</strong></td>
                        <td style="padding: 6px 0; text-align: right;">${pga.toFixed(2)} cm/s²</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 6px 0; color: #666;"><strong>📏 Distance</strong></td>
                        <td style="padding: 6px 0; text-align: right;">${distanceKm.toFixed(1)} km from epicenter</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; color: #666;"><strong>🧮 Method</strong></td>
                        <td style="padding: 6px 0; text-align: right; font-size: 11px;">IDW Interpolation</td>
                    </tr>
                </table>
                
                <div style="background: #f9f9f9; padding: 10px; border-radius: 5px; border-left: 4px solid #667eea;">
                    <p style="font-size: 12px; color: #555; margin: 0; line-height: 1.5;">
                        <strong>⚠️ Expected Effects:</strong><br>
                        ${intensityInfo.description}
                    </p>
                </div>
            </div>
        `;
        
        // Display popup
        L.popup({
            maxWidth: 320,
            className: 'intensity-popup'
        })
        .setLatLng(e.latlng)
        .setContent(popupContent)
        .openOn(map);
        
        // Add temporary marker at click location
        const clickMarker = L.circleMarker(e.latlng, {
            radius: 8,
            fillColor: intensityInfo.color,
            color: '#333',
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.6
        }).addTo(map);
        
        // Remove marker after 5 seconds
        setTimeout(() => {
            map.removeLayer(clickMarker);
        }, 5000);
        
        // Log to console for debugging
        console.log(`Clicked: ${clickLat.toFixed(4)}, ${clickLon.toFixed(4)}`);
        console.log(`PGA: ${pga.toFixed(2)} cm/s² | Intensity: ${intensityInfo.level}`);
    });

    console.log('✓ Click-to-calculate system loaded (Wald et al. 1999 formula)');
    console.log('💡 Click anywhere on the map to see intensity calculations');
}, 100); // Small delay to ensure map is ready