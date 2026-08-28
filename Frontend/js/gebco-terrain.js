/**
 * GEBCO terrain + bathymetry overlay.
 *
 * Renders gebco_calapan.tif as a colored elevation layer:
 *   ocean depths in blues, land elevation in green→yellow→brown→white.
 * Same approach as your PGA raster — uses georaster + georaster-layer-for-leaflet
 * (already loaded in index.html).
 *
 * Wiring (in map.js):
 *   const gebco = await GebcoTerrain.load('data/gebco_calapan.tif');
 *   // add to your layer control so users can toggle it:
 *   //   overlayMaps["🏔️ Terrain / Bathymetry"] = gebco;
 *   // optionally show by default:  gebco.addTo(map);
 *
 * Add to index.html before map.js (georaster libs must load first — you
 * already have them for the PGA raster):
 *   <script src="js/gebco-terrain.js"></script>
 */
(function (global) {
    'use strict';

    // Elevation → color. Mirrors the preview ramp.
    // Ocean (<0) blues; land (>=0) green→yellow→brown→white.
    function elevationColor(e) {
        // --- Ocean / bathymetry ---
        if (e < 0) {
            if (e < -3000) return 'rgba(8,48,107,0.85)';
            if (e < -2000) return 'rgba(8,81,156,0.85)';
            if (e < -1000) return 'rgba(33,113,181,0.82)';
            if (e <  -500) return 'rgba(66,146,198,0.80)';
            if (e <  -200) return 'rgba(107,174,214,0.78)';
            return 'rgba(198,219,239,0.75)';            // shallow water
        }
        // --- Land / topography ---
        if (e < 100)  return 'rgba(26,152,80,0.75)';    // coastal lowland
        if (e < 300)  return 'rgba(166,217,106,0.78)';
        if (e < 600)  return 'rgba(254,224,139,0.80)';
        if (e < 1000) return 'rgba(252,141,89,0.82)';
        if (e < 1500) return 'rgba(215,95,14,0.85)';
        if (e < 2000) return 'rgba(153,52,4,0.88)';
        return 'rgba(255,255,255,0.90)';                // peaks
    }

    const GebcoTerrain = {
        async load(url, opts = {}) {
            if (typeof parseGeoraster === 'undefined' ||
                typeof GeoRasterLayer === 'undefined') {
                throw new Error('georaster libraries not loaded — add the two '
                              + '<script> tags you use for the PGA raster.');
            }
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
            const arrayBuffer = await res.arrayBuffer();
            const georaster = await parseGeoraster(arrayBuffer);

            const noData = georaster.noDataValue;
            return new GeoRasterLayer({
                georaster,
                opacity: opts.opacity != null ? opts.opacity : 0.75,
                resolution: 256,
                pixelValuesToColorFn: (values) => {
                    const e = values[0];
                    if (e === null || e === undefined || e === noData || isNaN(e)) {
                        return null;  // transparent (e.g. outside data / NoData)
                    }
                    return elevationColor(e);
                },
            });
        },

        // HTML legend snippet for your legend control, if you want one
        legend() {
            const row = (color, label) =>
                `<div><span style="display:inline-block;width:14px;height:10px;`
                + `background:${color};margin-right:6px;vertical-align:middle"></span>${label}</div>`;
            return `
                <div style="font-size:12px">
                  <div style="font-weight:600;margin-bottom:4px">Elevation (m)</div>
                  ${row('#ffffff', '> 2000 (peaks)')}
                  ${row('#993404', '1000–2000')}
                  ${row('#fee08b', '300–1000')}
                  ${row('#1a9850', '0–300 (lowland)')}
                  ${row('#c6dbef', '0 to −200 (shallow)')}
                  ${row('#4292c6', '−200 to −1000')}
                  ${row('#08306b', '< −3000 (deep)')}
                </div>
            `;
        },
    };

    global.GebcoTerrain = GebcoTerrain;
})(window);