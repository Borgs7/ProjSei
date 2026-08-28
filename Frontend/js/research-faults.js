/**
 * Research Faults overlay layer (Batangas).
 *
 * Fault traces digitized from published academic research — kept visually
 * DISTINCT from the official PHIVOLCS active faults (which are red/orange).
 * These render in purple so users can tell at a glance that they're looking
 * at research data rather than the national catalog.
 *
 * Sources currently included:
 *   • Austria et al. (2023) — 5 traces
 *   • Frias et al. (2019)   — 3 traces (has Normal/Reverse mechanism)
 *   • Rohrlach (2012)       — 193 traces
 *
 * NOTE ON ATTRIBUTES: unlike the PHIVOLCS data, these datasets carry no fault
 * names. Popups therefore show the source publication, mechanism (where known),
 * and computed length — that's all the source data provides.
 *
 * Wiring (map.js):
 *   ResearchFaults.fromStatic('data/research_faults.geojson')
 *       .then(layer => { researchFaultsLayer = layer; layer.addTo(map); });
 *   // or from the API:
 *   ResearchFaults.fromApi('http://localhost:8000/api/hazards/research-faults')
 *
 * index.html (before map.js):
 *   <script src="js/research-faults.js"></script>
 */
(function (global) {
    'use strict';

    const COLOR = '#7b3fa0';   // purple — deliberately distinct from PHIVOLCS red/orange

    function styleFor() {
        // Uniform styling: the source data has no classification to vary on.
        return { color: COLOR, weight: 2, opacity: 0.85 };
    }

    function formatLength(m) {
        if (m == null) return null;
        return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
    }

    function popupHtml(p) {
        const row = (label, value) => value
            ? `<tr><td style="padding:2px 8px 2px 0;color:#666">${label}</td><td>${value}</td></tr>`
            : '';
        return `
            <div style="font-family:system-ui,sans-serif;font-size:13px;min-width:230px">
              <div style="font-weight:600;font-size:14px;margin-bottom:2px;color:${COLOR}">
                Research fault trace
              </div>
              <div style="color:#888;font-size:11px;margin-bottom:6px">
                Not part of the PHIVOLCS official catalog
              </div>
              <table style="border-collapse:collapse">
                ${row('Source',    p.source)}
                ${row('Mechanism', p.mechanism)}
                ${row('Length',    formatLength(p.length_m))}
                ${row('Notes',     p.description)}
              </table>
            </div>
        `;
    }

    function buildLayer(geojson, map) {
        return L.geoJSON(geojson, {
            style: styleFor,
            onEachFeature: (feature, layer) => {
                const p = feature.properties || {};
                layer.bindPopup(popupHtml(p));
                layer.bindTooltip(p.source || 'Research fault',
                                  { sticky: true, direction: 'top' });
                layer.on('mouseover', () => {
                    layer.setStyle({ weight: 4 });
                    layer.bringToFront();
                });
                layer.on('mouseout', () => layer.setStyle(styleFor()));
            },
        });
    }

    const ResearchFaults = {
        async fromStatic(url) {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
            return buildLayer(await res.json());
        },

        async fromApi(baseUrl, opts = {}) {
            const url = new URL(baseUrl);
            if (opts.source) url.searchParams.set('source', opts.source);
            if (opts.bbox)   url.searchParams.set('bbox', opts.bbox);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to load research faults: ${res.status}`);
            return buildLayer(await res.json());
        },

        legend() {
            return `
                <div style="font-size:12px">
                  <div style="font-weight:600;margin-bottom:4px">Research Faults</div>
                  <div>
                    <span style="display:inline-block;width:18px;height:0;
                                 border-top:2px solid ${COLOR};vertical-align:middle"></span>
                    Published research (Batangas)
                  </div>
                  <div style="color:#888;font-size:10px;margin-top:2px">
                    Austria 2023 · Frias 2019 · Rohrlach 2012
                  </div>
                </div>
            `;
        },
    };

    global.ResearchFaults = ResearchFaults;
})(window);