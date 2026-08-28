/**
 * Nearest-Fault click feature.
 *
 * On any map click, asks the API which fault is closest, draws a dashed line
 * from the click to the nearest point on that fault, and shows the fault name
 * + distance in a small floating panel.
 *
 * It uses its OWN panel (not a Leaflet popup), so it coexists peacefully with
 * your existing click-to-calculate PGA/MMI popup — one click triggers both.
 *
 * Wiring (in map.js, after the map is created):
 *   NearestFault.init(map, 'http://localhost:8000');
 *
 * Add to index.html before map.js:
 *   <script src="js/nearest-fault.js"></script>
 */
(function (global) {
    'use strict';

    const COLOR = '#1f77b4';  // blue connector, distinct from the red faults

    const NearestFault = {
        _line: null,
        _marker: null,
        _map: null,
        _apiBase: null,

        init(map, apiBase) {
            this._map = map;
            this._apiBase = apiBase.replace(/\/$/, '');  // trim trailing slash

            // Dedicated pane so the connector + marker render above the
            // GEBCO GeoRasterLayer (which sits in overlayPane, zIndex 400).
            map.createPane('nearestFaultPane');
            map.getPane('nearestFaultPane').style.zIndex = 650;

            map.on('click', (e) => this._onClick(e.latlng));
        },

        async _onClick(latlng) {
            const url = `${this._apiBase}/api/hazards/nearest-fault`
                      + `?lat=${latlng.lat}&lon=${latlng.lng}`;
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                this._render(latlng, data);
            } catch (err) {
                console.warn('Nearest-fault lookup failed:', err.message);
            }
        },

        _render(clickLatLng, data) {
            // Clear previous line/marker
            if (this._line)   this._map.removeLayer(this._line);
            if (this._marker) this._map.removeLayer(this._marker);

            // nearest_point is GeoJSON: coordinates are [lon, lat]
            const [flon, flat] = data.nearest_point.coordinates;

            // Dashed connector from click → nearest point on the fault
            this._line = L.polyline(
                [[clickLatLng.lat, clickLatLng.lng], [flat, flon]],
                { color: COLOR, weight: 2, dashArray: '5,6', opacity: 0.9, pane: 'nearestFaultPane' }
            ).addTo(this._map);
            this._line.bringToFront();

            // Dot marking the nearest point on the fault
            this._marker = L.circleMarker([flat, flon], {
                radius: 5, color: COLOR, fillColor: COLOR, fillOpacity: 0.9, weight: 2, pane: 'nearestFaultPane'
            }).addTo(this._map);

            this._updatePanel(data);
        },

        _formatDistance(m) {
            if (m < 1000) return `${Math.round(m)} m`;
            return `${(m / 1000).toFixed(2)} km`;
        },

        _updatePanel(data) {
            let panel = document.getElementById('nearest-fault-panel');
            if (!panel) {
                panel = document.createElement('div');
                panel.id = 'nearest-fault-panel';
                panel.style.cssText = [
                    'position:absolute', 'bottom:20px', 'left:20px', 'z-index:1000',
                    'background:rgba(20,28,40,0.92)', 'color:#fff',
                    'font-family:system-ui,sans-serif', 'font-size:13px',
                    'padding:12px 14px', 'border-radius:8px',
                    'box-shadow:0 2px 10px rgba(0,0,0,0.4)', 'max-width:260px',
                    'border-left:3px solid ' + COLOR
                ].join(';');
                document.body.appendChild(panel);
            }
            const name = data.fault_name || 'Unnamed fault';
            const seg = data.segment_name ? ` — ${data.segment_name}` : '';
            panel.innerHTML = `
                <div style="font-weight:600;margin-bottom:4px">Nearest active fault</div>
                <div style="font-size:14px;margin-bottom:2px">${name}${seg}</div>
                <div style="color:#9fb4cc;margin-bottom:6px">${data.fault_class || ''}</div>
                <div style="font-size:18px;font-weight:700;color:${COLOR === '#1f77b4' ? '#7fb2e6' : COLOR}">
                    ${this._formatDistance(data.distance_m)}
                </div>
                <div style="color:#9fb4cc;font-size:11px">straight-line distance from your click</div>
            `;
        },

        // Optional: call to clear the line/marker/panel
        clear() {
            if (this._line)   this._map.removeLayer(this._line);
            if (this._marker) this._map.removeLayer(this._marker);
            const panel = document.getElementById('nearest-fault-panel');
            if (panel) panel.remove();
            this._line = this._marker = null;
        },
    };

    global.NearestFault = NearestFault;
})(window);