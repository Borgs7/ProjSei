/**
 * layer-panel.js — the Layers tab of the map side panel (map.html).
 *
 * Replaces Leaflet's L.control.layers box (and the old 2-second timer that
 * built it). Each data layer registers here as soon as it finishes loading:
 *
 *   LayerPanel.register('faults', faultsLayer);   // row becomes active
 *   LayerPanel.fail('faults');                    // row shows "Unavailable"
 *
 * The switches add/remove that SAME Leaflet layer object, so a layer's
 * default on/off state is simply whether map.js added it to the map.
 * Rows in map.html are matched by data-layer="<id>".
 */
(function (global) {
    'use strict';

    const LayerPanel = {
        _map: null,
        _layers: {},
        _baseLayers: null,
        _base: null,

        init(map) {
            this._map = map;

            document.querySelectorAll('.lyr[data-layer] .tog').forEach((tog) => {
                tog.addEventListener('click', () => this._toggle(tog.closest('.lyr').dataset.layer));
            });
            document.querySelectorAll('.opac[data-opacity-for] input').forEach((range) => {
                range.addEventListener('input', () => this._setOpacity(range));
            });
            document.querySelectorAll('.base[data-base]').forEach((btn) => {
                btn.addEventListener('click', () => this.setBase(btn.dataset.base));
            });
        },

        // ---- Base maps ----
        setBasemaps(layers, defaultKey) {
            this._baseLayers = layers;
            this.setBase(defaultKey);
        },

        setBase(key) {
            const next = this._baseLayers && this._baseLayers[key];
            if (!next || next === this._base) return;

            if (this._base) this._map.removeLayer(this._base);
            // Some tile servers stop at a lower zoom (OpenTopoMap: 17)
            const maxZoom = next.options.maxZoom;
            if (maxZoom && this._map.getZoom() > maxZoom) this._map.setZoom(maxZoom);
            next.addTo(this._map);
            next.bringToBack();
            this._base = next;

            document.querySelectorAll('.base[data-base]').forEach((btn) => {
                const on = btn.dataset.base === key;
                btn.classList.toggle('on', on);
                btn.setAttribute('aria-pressed', on);
            });
        },

        // ---- Data layers ----
        register(id, layer) {
            this._layers[id] = layer;
            const row = this._row(id);
            if (!row) return;

            row.classList.remove('is-loading', 'is-unavailable');
            row.removeAttribute('title');
            row.querySelector('.lyr-sub').textContent = row.dataset.sub || '';
            row.querySelector('.tog').disabled = false;

            const range = this._range(id);
            if (range) {
                range.disabled = false;
                if (layer.options && layer.options.opacity != null) {
                    range.value = Math.round(layer.options.opacity * 100);
                }
                this._showOpacity(range);
            }
            this._sync(id);
        },

        fail(id, reason) {
            delete this._layers[id];
            const row = this._row(id);
            if (!row) return;

            row.classList.remove('is-loading', 'on');
            row.classList.add('is-unavailable');
            row.querySelector('.lyr-sub').textContent = 'Unavailable';
            if (reason) row.title = reason;
            const tog = row.querySelector('.tog');
            tog.disabled = true;
            tog.setAttribute('aria-checked', 'false');
            const range = this._range(id);
            if (range) range.disabled = true;
            if (id === 'pga') this._updateMiniLegend();
        },

        isOn(id) {
            const layer = this._layers[id];
            return !!layer && this._map.hasLayer(layer);
        },

        _toggle(id) {
            const layer = this._layers[id];
            if (!layer) return;
            if (this._map.hasLayer(layer)) this._map.removeLayer(layer);
            else layer.addTo(this._map);
            this._sync(id);
        },

        // Reflect the layer's real on/off state in its row
        _sync(id) {
            const row = this._row(id);
            const on = this.isOn(id);
            if (row) {
                row.classList.toggle('on', on);
                row.querySelector('.tog').setAttribute('aria-checked', on);
            }
            if (id === 'pga') this._updateMiniLegend();
        },

        _setOpacity(range) {
            const id = range.closest('.opac').dataset.opacityFor;
            const layer = this._layers[id];
            if (layer && layer.setOpacity) layer.setOpacity(range.value / 100);
            this._showOpacity(range);
        },

        _showOpacity(range) {
            range.closest('.opac').querySelector('output').textContent = range.value + '%';
        },

        // Compact MMI legend on the map: only while Shaking intensity is on
        _updateMiniLegend() {
            const el = document.getElementById('mini-legend');
            if (el) el.hidden = !this.isOn('pga');
        },

        _row(id) {
            return document.querySelector('.lyr[data-layer="' + id + '"]');
        },

        _range(id) {
            return document.querySelector('.opac[data-opacity-for="' + id + '"] input');
        }
    };

    global.LayerPanel = LayerPanel;
})(window);
