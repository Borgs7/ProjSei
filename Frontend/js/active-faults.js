/**
 * Active Faults overlay layer.
 *
 * Two data sources supported:
 *   1. Static GeoJSON file (faster cold load, simpler):
 *        ActiveFaults.fromStatic('data/active_faults.geojson')
 *   2. API endpoint (preferred — bbox-aware, simplification on demand):
 *        ActiveFaults.fromApi('http://localhost:8000/api/hazards/active-faults')
 *
 * Wiring into your existing map:
 *   const faults = await ActiveFaults.fromApi(API_BASE + '/api/hazards/active-faults');
 *   faults.addTo(map);                              // show by default
 *   layerControl.addOverlay(faults, 'Active Faults'); // toggleable in your control
 *
 * Styling rationale:
 *   PHIVOLCS conventions, simplified for Leaflet's polyline capabilities:
 *     • Active Fault          → red
 *     • Potentially Active    → orange
 *     • Trace certainty       → solid (Certain) vs dashed (Approximate)
 *     • Concealed             → dotted, lower opacity
 *   Fancier symbology (hachures, sawteeth, arrows) is preserved in the
 *   `symbology` property and will be rendered properly during the MapLibre
 *   migration using line-pattern.
 */
(function (global) {
    'use strict';

    // -------- Style logic --------
    const COLORS = {
        ACTIVE: '#d62728',        // PHIVOLCS red
        POTENTIALLY: '#ff7f0e',   // orange for potentially active
        CONCEALED: '#7f7f7f',     // grey for concealed traces
    };

    function styleFor(props) {
        const fclass = (props.fault_class || '').toLowerCase();
        const ttype  = (props.trace_type   || '').toLowerCase();

        let color = COLORS.ACTIVE;
        if (fclass.includes('potentially')) color = COLORS.POTENTIALLY;

        let weight  = 2;
        let opacity = 0.9;
        let dashArray = null;

        if (ttype.includes('concealed')) {
            color = COLORS.CONCEALED;
            dashArray = '2,4';
            opacity = 0.7;
        } else if (ttype.includes('approximate')) {
            dashArray = '6,4';
        }
        // 'Certain' falls through as solid

        if (fclass.includes('potentially')) {
            weight = 1.5;
            // make potentially-active dashed even when "Certain"
            if (!dashArray) dashArray = '4,3';
        }

        return { color, weight, opacity, dashArray };
    }

    // -------- Popup content --------
    function popupHtml(props) {
        const row = (label, value) => value
            ? `<tr><td style="padding:2px 6px 2px 0;color:#666">${label}</td><td>${value}</td></tr>`
            : '';
        return `
            <div style="font-family:system-ui,sans-serif;font-size:13px;min-width:220px">
              <div style="font-weight:600;font-size:14px;margin-bottom:4px">
                ${props.fault_name || 'Unnamed fault'}
              </div>
              <table style="border-collapse:collapse">
                ${row('Segment',   props.segment_name)}
                ${row('Class',     props.fault_class)}
                ${row('Trace',     props.trace_type)}
                ${row('Mechanism', props.mechanism)}
              </table>
            </div>
        `;
    }

    // -------- Layer factory --------
    function buildLayer(geojson) {
        return L.geoJSON(geojson, {
            style: feature => styleFor(feature.properties || {}),
            onEachFeature: (feature, layer) => {
                const p = feature.properties || {};
                layer.bindPopup(popupHtml(p));
                layer.bindTooltip(
                    p.fault_name || p.segment_name || 'Fault',
                    { sticky: true, direction: 'top' }
                );
                // Hover emphasis
                layer.on('mouseover', () => {
                    layer.setStyle({ weight: (styleFor(p).weight || 2) + 2 });
                    layer.bringToFront();
                });
                layer.on('mouseout', () => {
                    layer.setStyle(styleFor(p));
                });
            },
            // Class assignments make custom CSS styling possible if desired
            className: 'active-fault-line',
        });
    }

    // -------- Public API --------
    const ActiveFaults = {
        async fromStatic(url) {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
            return buildLayer(await res.json());
        },

        async fromApi(baseUrl, opts = {}) {
            // opts: { bbox: '...', fault_class: '...', simplify_m: 100 }
            const url = new URL(baseUrl);
            if (opts.bbox)        url.searchParams.set('bbox', opts.bbox);
            if (opts.fault_class) url.searchParams.set('fault_class', opts.fault_class);
            if (opts.simplify_m)  url.searchParams.set('simplify_m', opts.simplify_m);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to load faults: ${res.status}`);
            return buildLayer(await res.json());
        },

        // For your legend control if you want a swatch
        legend() {
            return `
                <div style="font-size:12px">
                  <div style="font-weight:600;margin-bottom:4px">Active Faults</div>
                  <div><span style="display:inline-block;width:18px;height:0;border-top:2px solid ${COLORS.ACTIVE};vertical-align:middle"></span> Active — Certain</div>
                  <div><span style="display:inline-block;width:18px;height:0;border-top:2px dashed ${COLORS.ACTIVE};vertical-align:middle"></span> Active — Approximate</div>
                  <div><span style="display:inline-block;width:18px;height:0;border-top:1.5px dashed ${COLORS.POTENTIALLY};vertical-align:middle"></span> Potentially Active</div>
                  <div><span style="display:inline-block;width:18px;height:0;border-top:2px dotted ${COLORS.CONCEALED};vertical-align:middle"></span> Concealed</div>
                </div>
            `;
        },
    };

    global.ActiveFaults = ActiveFaults;
})(window);