/**
 * place-labels.js — zoom-based place names on the hazard map (map.html).
 *
 * The base map tiles are label-free, so names come from here:
 *   • zoom ≤ 11: our own labels from data/place_labels.geojson, filtered by zoom
 *     (provinces + major cities when zoomed out, municipalities only when zoomed in)
 *   • zoom ≥ 12: detailed names-only tiles for the active base map
 *     (CARTO for Light / Streets, Esri for Terrain — set up in map.js)
 *
 * Labels sit in their own pane — above the hazard layers, below markers and
 * popups — and never take mouse clicks. When two names would overlap, the less
 * important one is skipped (the data file is already sorted by importance).
 *
 * Wiring (map.js, before LayerPanel.setBasemaps):
 *   PlaceLabels.init(map, { url: 'data/place_labels.geojson', labelTiles: { light, streets, terrain } });
 * layer-panel.js calls PlaceLabels.setBase(key) whenever the base map changes.
 *
 * Data: Backend/scripts/build_place_labels.py (PSA PSGC boundaries).
 */
(function (global) {
    'use strict';

    const PANE = 'placeLabels';
    const DETAIL_ZOOM = 12;   // from here on, CARTO's detailed label tiles replace ours
    const GAP = 6;            // minimum gap between two labels, in screen pixels
    const EDGE = 60;          // also place labels this far outside the view, for smoother panning

    // Zoom range (Leaflet zoom levels, inclusive) and style for each kind of place
    const RULES = {
        major:    { min: 5,  max: 11, cls: 'pl-major' },     // Manila, Cebu City, Davao City
        province: { min: 6,  max: 10, cls: 'pl-province' },
        huc:      { min: 7,  max: 11, cls: 'pl-huc' },       // highly urbanized + independent cities outside Metro Manila
        ncr:      { min: 10, max: 11, cls: 'pl-city' },      // other Metro Manila cities
        city:     { min: 9,  max: 11, cls: 'pl-city' },      // all other cities
        mun:      { min: 10, max: 11, cls: 'pl-mun' }        // municipalities
    };

    // The fonts used by the label styles in css/style.css. Labels are measured only
    // once these have loaded, or the overlap check would use the wrong text widths.
    const FONTS = ['800 15px Archivo', '700 13px Archivo', '700 11px Archivo',
                   '600 12px Archivo', '500 11.5px "Public Sans"'];

    const PlaceLabels = {
        _map: null,
        _box: null,
        _places: [],
        _ready: false,
        _base: null,
        _labelTiles: {},
        _activeTiles: null,
        _sizes: new Map(),
        _frame: null,

        init(map, opts) {
            this._map = map;
            this._labelTiles = opts.labelTiles || {};

            const pane = map.createPane(PANE);
            pane.style.zIndex = 450;             // hazard layers 400 < labels < markers 600, popups 700
            pane.style.pointerEvents = 'none';   // clicks go straight through to the map

            // Our labels. Hidden while Leaflet animates a zoom, redrawn when it ends.
            this._box = L.DomUtil.create('div', 'place-labels leaflet-zoom-hide', pane);
            map.on('zoomstart', () => this._box.replaceChildren());
            map.on('zoomend moveend', () => this._schedule());

            let fontsReady = Promise.resolve();
            if (document.fonts) {
                fontsReady = Promise.all(FONTS.map((font) => document.fonts.load(font)))
                    .then(() => document.fonts.ready)
                    .catch(() => {});
                // A font that arrives later changes text widths: measure again
                document.fonts.addEventListener('loadingdone', () => {
                    this._sizes.clear();
                    this._schedule();
                });
            }

            const places = fetch(opts.url).then((response) => {
                if (!response.ok) throw new Error(`Failed to load ${opts.url}: ${response.status}`);
                return response.json();
            });

            Promise.all([places, fontsReady])
                .then(([geojson]) => {
                    this._places = geojson.features
                        .filter((f) => RULES[f.properties.kind])
                        .map((f) => ({
                            name: f.properties.name,
                            rule: RULES[f.properties.kind],
                            latlng: L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0])
                        }));
                    this._ready = true;
                    this._schedule();
                    console.log(`✓ Place labels loaded (${this._places.length} places)`);
                })
                .catch((error) => console.warn('Place labels not loaded:', error.message));
        },

        // Called by layer-panel.js whenever the base map changes ('light' | 'terrain' | 'streets')
        setBase(key) {
            this._base = key;
            this._schedule();
        },

        // At most one update per animation frame (zoomend and moveend often fire together)
        _schedule() {
            if (this._frame) return;
            this._frame = requestAnimationFrame(() => {
                this._frame = null;
                this._update();
            });
        },

        _update() {
            const map = this._map;
            const zoom = map.getZoom();

            // Detail label tiles at zoom 12+. Added/removed by hand on purpose: giving these
            // layers a minZoom would make Leaflet treat it as a limit for the WHOLE map.
            const tiles = zoom >= DETAIL_ZOOM ? (this._labelTiles[this._base] || null) : null;
            if (tiles !== this._activeTiles) {
                if (this._activeTiles) map.removeLayer(this._activeTiles);
                if (tiles) tiles.addTo(map);
                this._activeTiles = tiles;
            }

            if (!this._ready || zoom >= DETAIL_ZOOM) {
                this._box.replaceChildren();
                return;
            }
            this._layout(zoom);
        },

        // Greedy placement: most important first; skip any label that would overlap one already placed
        _layout(zoom) {
            const map = this._map;
            const size = map.getSize();

            const candidates = [];
            for (const p of this._places) {
                if (zoom < p.rule.min || zoom > p.rule.max) continue;
                const cp = map.latLngToContainerPoint(p.latlng);
                if (cp.x < -EDGE || cp.y < -EDGE || cp.x > size.x + EDGE || cp.y > size.y + EDGE) continue;
                candidates.push({ p, cp });
            }
            this._measure(candidates.map((c) => c.p));

            const placed = [];
            const frag = document.createDocumentFragment();
            for (const { p, cp } of candidates) {
                const s = this._sizes.get(this._key(p));
                const box = {
                    x1: cp.x - s.w / 2 - GAP / 2, y1: cp.y - s.h / 2 - GAP / 2,
                    x2: cp.x + s.w / 2 + GAP / 2, y2: cp.y + s.h / 2 + GAP / 2
                };
                if (placed.some((q) => box.x1 < q.x2 && box.x2 > q.x1 && box.y1 < q.y2 && box.y2 > q.y1)) continue;
                placed.push(box);

                // Centred on the point (no dot: the point is the area's centre, not the town centre)
                const el = this._label(p);
                L.DomUtil.setPosition(el, map.latLngToLayerPoint(p.latlng).subtract([s.w / 2, s.h / 2]).round());
                frag.append(el);
            }
            this._box.replaceChildren(frag);
        },

        // Measure labels not measured yet, all in one batch (a single layout pass)
        _measure(places) {
            const todo = places.filter((p) => !this._sizes.has(this._key(p)));
            if (!todo.length) return;
            const probe = L.DomUtil.create('div', 'place-labels-probe', this._box);
            const els = todo.map((p) => probe.appendChild(this._label(p)));
            els.forEach((el, i) => this._sizes.set(this._key(todo[i]), { w: el.offsetWidth, h: el.offsetHeight }));
            probe.remove();
        },

        _key(p) {
            return p.rule.cls + '|' + p.name;
        },

        _label(p) {
            const el = document.createElement('div');
            el.className = 'place-label ' + p.rule.cls;
            el.textContent = p.name;
            return el;
        }
    };

    global.PlaceLabels = PlaceLabels;
})(window);
