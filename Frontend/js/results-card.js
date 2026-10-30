/**
 * results-card.js — the click result card on the hazard map (map.html).
 *
 * Replaces the old Leaflet popups. Two independent map-click handlers report
 * into it — click-calculator.js (intensity) and nearest-fault.js (nearest
 * fault) — and every update carries the clicked latlng, so a slow answer from
 * an earlier click can never overwrite the card for a newer one.
 *
 * Wiring (map.js, after the map is created):  ResultsCard.init(map);
 */
(function (global) {
    'use strict';

    const NEUTRAL = '#F4E4C4';   // --cream: band colour while calculating / for messages

    function formatCoords(latlng) {
        const lat = Math.abs(latlng.lat).toFixed(2) + '°' + (latlng.lat >= 0 ? 'N' : 'S');
        const lon = Math.abs(latlng.lng).toFixed(2) + '°' + (latlng.lng >= 0 ? 'E' : 'W');
        return lat + ', ' + lon;
    }

    // Write "238 cm/s²"-style values: number + small unit
    function setStat(dd, value, unit) {
        dd.textContent = value;
        if (unit) {
            const small = document.createElement('small');
            small.textContent = ' ' + unit;
            dd.append(small);
        }
    }

    function formatPga(value) {
        const v = Number(value);
        if (!isFinite(v)) return '—';
        return v >= 100 ? String(Math.round(v)) : v.toFixed(1);
    }

    function formatKm(value) {
        const v = Number(value);
        return isFinite(v) ? v.toFixed(1) : '—';
    }

    const ResultsCard = {
        _map: null,
        _key: null,
        _ring: null,
        _els: null,

        init(map) {
            this._map = map;
            const $ = (id) => document.getElementById(id);
            this._els = {
                card: $('result-card'), band: $('rc-band'), kicker: $('rc-kicker'),
                title: $('rc-title'), coords: $('rc-coords'), pga: $('rc-pga'), dist: $('rc-dist'),
                fault: $('rc-fault'), effRow: $('rc-eff-row'), effLabel: $('rc-eff-label'),
                eff: $('rc-eff'), src: $('rc-src'), close: $('rc-close')
            };
            this._els.close.addEventListener('click', () => this.close());
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !this._els.card.hidden && !e.target.closest('.search')) this.close();
            });
        },

        _keyOf(latlng) {
            return latlng.lat.toFixed(6) + ',' + latlng.lng.toFixed(6);
        },

        isCurrent(latlng) {
            return this._key === this._keyOf(latlng);
        },

        /**
         * Start a new result. Both click handlers call this first; only the
         * first call for a given click resets the card to "Calculating…".
         */
        open(latlng) {
            const key = this._keyOf(latlng);
            if (key === this._key) return;
            this._key = key;

            const els = this._els;
            this._setColour(NEUTRAL);
            els.kicker.textContent = 'Expected shaking';
            els.title.textContent = 'Calculating…';
            els.coords.textContent = formatCoords(latlng);
            setStat(els.pga, '—');
            setStat(els.dist, '—');
            els.fault.textContent = 'Finding the nearest fault…';
            els.effRow.hidden = true;
            els.src.textContent = '';
            this._placeRing(latlng);
            els.card.hidden = false;
        },

        /**
         * Intensity result. `data` uses the API's field names (the offline
         * fallback builds the same shape): intensity_level, mmi, color,
         * pga_value, distance_from_epicenter_km, description.
         */
        showResult(latlng, data, source) {
            if (!this.isCurrent(latlng)) return;
            const els = this._els;

            // Prefer the shared MMI table so the card, raster and legend always match
            const colour = (data.mmi && typeof getIntensityDescription === 'function')
                ? getIntensityDescription(data.mmi).color
                : (data.color || NEUTRAL);

            this._setColour(colour);
            els.kicker.textContent = 'Expected shaking';
            els.title.textContent = String(data.intensity_level || '').replace(' — ', ' · ');
            setStat(els.pga, formatPga(data.pga_value), 'cm/s²');
            setStat(els.dist, formatKm(data.distance_from_epicenter_km), 'km');
            els.effLabel.textContent = 'What people would feel';
            els.eff.textContent = data.description || '';
            els.effRow.hidden = !data.description;
            els.src.textContent = source === 'api'
                ? 'PostGIS · IDW · Wald 1999'
                : 'Offline data · IDW · Wald 1999';
        },

        /** Outside-coverage / no-data / offline cases, shown in the same card. */
        showMessage(latlng, title, text, distanceKm) {
            if (!this.isCurrent(latlng)) return;
            const els = this._els;
            this._setColour(NEUTRAL);
            els.kicker.textContent = 'No result';
            els.title.textContent = title;
            setStat(els.pga, '—');
            if (distanceKm != null) setStat(els.dist, formatKm(distanceKm), 'km');
            else setStat(els.dist, '—');
            els.effLabel.textContent = 'Details';
            els.eff.textContent = text;
            els.effRow.hidden = !text;
            els.src.textContent = '';
        },

        /** Nearest-fault line of the card (from nearest-fault.js). */
        setFault(latlng, text) {
            if (!this.isCurrent(latlng)) return;
            this._els.fault.textContent = text;
        },

        close() {
            this._els.card.hidden = true;
            this._key = null;
            if (this._ring) {
                this._map.removeLayer(this._ring);
                this._ring = null;
            }
            if (global.NearestFault) NearestFault.clear();
        },

        _setColour(colour) {
            this._els.band.style.background = colour;
            const el = this._ring && this._ring.getElement();
            if (el) el.style.setProperty('--ring-fill', colour);
        },

        // Clicked-point marker; stays until the card is closed or the map is clicked again
        _placeRing(latlng) {
            if (this._ring) this._map.removeLayer(this._ring);
            this._ring = L.marker(latlng, {
                icon: L.divIcon({ className: 'click-ring', iconSize: [18, 18] }),
                interactive: false,
                keyboard: false
            }).addTo(this._map);
        }
    };

    global.ResultsCard = ResultsCard;
})(window);
