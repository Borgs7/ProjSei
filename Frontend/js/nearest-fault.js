/**
 * Nearest-Fault click feature.
 *
 * On any map click, finds the closest active fault, draws a dashed line from
 * the click to the nearest point on that fault, and reports the fault name +
 * distance to the results card (js/results-card.js). One click triggers both
 * this and the intensity calculation in click-calculator.js.
 *
 * Source of the answer:
 *   1. The API (/api/hazards/nearest-fault) when it's connected.
 *   2. Otherwise an offline estimate from the PHIVOLCS active-faults layer
 *      already loaded on the map (so it also works on GitHub Pages).
 *
 * Wiring (in map.js, after the map is created):
 *   NearestFault.init(map, 'http://localhost:8000');
 *   NearestFault.useLayer(faultsLayer);   // once the active faults have loaded
 */
(function (global) {
    'use strict';

    const COLOR = '#1f77b4';  // blue connector, distinct from the red faults

    // Great-circle distance in metres
    function haversineM(lat1, lon1, lat2, lon2) {
        const r = Math.PI / 180;
        const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
        return 2 * 6371000 * Math.asin(Math.sqrt(a));
    }

    // Polyline latlngs are an array of LatLngs, or nested arrays for multi-lines
    function lineParts(latlngs) {
        if (!latlngs.length) return [];
        return Array.isArray(latlngs[0]) ? latlngs.flatMap(lineParts) : [latlngs];
    }

    const NearestFault = {
        _line: null,
        _marker: null,
        _map: null,
        _apiBase: null,
        _faults: null,

        init(map, apiBase) {
            this._map = map;
            this._apiBase = apiBase.replace(/\/$/, '');  // trim trailing slash

            // Dedicated pane so the connector + marker render above the
            // GEBCO GeoRasterLayer (which sits in overlayPane, zIndex 400).
            map.createPane('nearestFaultPane');
            map.getPane('nearestFaultPane').style.zIndex = 650;

            map.on('click', (e) => this._onClick(e.latlng));
        },

        // The active-faults layer used for the offline estimate
        useLayer(layer) {
            this._faults = layer;
        },

        async _onClick(latlng) {
            if (global.ResultsCard) ResultsCard.open(latlng);

            let data = null;
            // `apiConnected` is set by click-calculator.js after its health check
            if (typeof apiConnected !== 'undefined' && apiConnected) {
                const url = `${this._apiBase}/api/hazards/nearest-fault`
                          + `?lat=${latlng.lat}&lon=${latlng.lng}`;
                try {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    data = await res.json();
                } catch (err) {
                    console.warn('Nearest-fault lookup failed, using offline estimate:', err.message);
                }
            }
            if (!data || !data.nearest_point) data = this._nearestOffline(latlng);

            if (!data) {
                if (global.ResultsCard) {
                    ResultsCard.setFault(latlng, this._faults
                        ? 'No active fault found nearby'
                        : 'Fault data is still loading — try again in a moment');
                }
                return;
            }
            this._render(latlng, data);
        },

        /**
         * Offline estimate: closest point on any PHIVOLCS fault line to the click.
         * The search uses a local flat (equirectangular) projection around the click;
         * the reported distance is then the great-circle distance to the point found.
         * Returns the same shape as the API response.
         */
        _nearestOffline(latlng) {
            if (!this._faults) return null;

            const lat0 = latlng.lat;
            const lon0 = latlng.lng;
            const kx = 111.320 * Math.cos(lat0 * Math.PI / 180);  // km per degree longitude here
            const ky = 110.574;                                    // km per degree latitude
            let best = null;

            this._faults.eachLayer((layer) => {
                if (!layer.getLatLngs) return;
                const props = (layer.feature && layer.feature.properties) || {};

                lineParts(layer.getLatLngs()).forEach((line) => {
                    for (let i = 1; i < line.length; i++) {
                        // Segment end points in km, relative to the click
                        const ax = (line[i - 1].lng - lon0) * kx, ay = (line[i - 1].lat - lat0) * ky;
                        const bx = (line[i].lng - lon0) * kx,     by = (line[i].lat - lat0) * ky;
                        const dx = bx - ax, dy = by - ay;
                        const len2 = dx * dx + dy * dy;
                        // Projection of the click (origin) onto the segment, clamped to its ends
                        const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
                        const px = ax + t * dx, py = ay + t * dy;
                        const d2 = px * px + py * py;
                        if (!best || d2 < best.d2) {
                            best = { d2, lat: lat0 + py / ky, lon: lon0 + px / kx, props };
                        }
                    }
                });
            });

            if (!best) return null;
            return {
                fault_name: best.props.fault_name,
                segment_name: best.props.segment_name,
                fault_class: best.props.fault_class,
                distance_m: haversineM(lat0, lon0, best.lat, best.lon),
                nearest_point: { type: 'Point', coordinates: [best.lon, best.lat] }
            };
        },

        _render(clickLatLng, data) {
            // Ignore a slow answer for an earlier click
            if (global.ResultsCard && !ResultsCard.isCurrent(clickLatLng)) return;

            // Clear previous line/marker
            if (this._line)   this._map.removeLayer(this._line);
            if (this._marker) this._map.removeLayer(this._marker);

            // nearest_point is GeoJSON: coordinates are [lon, lat]
            const [flon, flat] = data.nearest_point.coordinates;

            // Dashed connector from click → nearest point on the fault
            this._line = L.polyline(
                [[clickLatLng.lat, clickLatLng.lng], [flat, flon]],
                { color: COLOR, weight: 2, dashArray: '5,6', opacity: 0.9, pane: 'nearestFaultPane', interactive: false }
            ).addTo(this._map);
            this._line.bringToFront();

            // Dot marking the nearest point on the fault
            this._marker = L.circleMarker([flat, flon], {
                radius: 5, color: COLOR, fillColor: COLOR, fillOpacity: 0.9, weight: 2,
                pane: 'nearestFaultPane', interactive: false
            }).addTo(this._map);

            if (global.ResultsCard) {
                const name = data.fault_name || 'Unnamed fault';
                const seg = data.segment_name ? ` — ${data.segment_name}` : '';
                ResultsCard.setFault(clickLatLng, `${name}${seg} · ${this._formatDistance(data.distance_m)} away`);
            }
        },

        _formatDistance(m) {
            if (m < 1000) return `${Math.round(m)} m`;
            return `${(m / 1000).toFixed(1)} km`;
        },

        // Clear the line/marker (called when the results card is closed)
        clear() {
            if (this._line)   this._map.removeLayer(this._line);
            if (this._marker) this._map.removeLayer(this._marker);
            this._line = this._marker = null;
        },
    };

    global.NearestFault = NearestFault;
})(window);
