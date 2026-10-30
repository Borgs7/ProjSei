/**
 * map-ui.js — hazard map page controls (map.html): location search, side
 * panel tabs + collapse, map buttons (zoom, reset view, my location) and the
 * "click the map" hint. Map logic itself lives in map.js and click-calculator.js.
 * Loaded last, after `map` and STUDY_VIEW exist (js/map.js).
 */
(function () {
    'use strict';
    if (typeof map === 'undefined') return;

    // ============================================
    // SEARCH — Nominatim (free OpenStreetMap geocoder), Philippines only.
    // Same behaviour as before: Enter searches, choosing a result flies there
    // and then calculates the intensity at that spot.
    // ============================================
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');

    function message(text) {
        const p = document.createElement('p');
        p.className = 'search-msg';
        p.textContent = text;
        return p;
    }

    // Built with textContent (not HTML strings), so place names can't inject markup
    function resultButton(place) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'search-result';

        const name = document.createElement('span');
        name.className = 'result-name';
        name.textContent = place.display_name.split(',').slice(0, 3).join(',');

        const coords = document.createElement('span');
        coords.className = 'result-coords';
        coords.textContent = `${parseFloat(place.lat).toFixed(4)}°N, ${parseFloat(place.lon).toFixed(4)}°E`;

        btn.append(name, coords);
        btn.addEventListener('click', () => goToLocation(parseFloat(place.lat), parseFloat(place.lon), place.display_name));
        return btn;
    }

    function showResults(nodes) {
        results.replaceChildren(...nodes);
        results.hidden = false;
    }

    function hideResults() {
        results.hidden = true;
    }

    async function searchLocation() {
        const query = input.value.trim();
        if (!query) return;
        showResults([message('Searching…')]);

        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=ph&limit=5`;
            const response = await fetch(url, { headers: { 'Accept-Language': 'en' } });
            const places = await response.json();
            if (places.length === 0) {
                showResults([message('No results found')]);
                return;
            }
            showResults(places.map(resultButton));
        } catch (error) {
            showResults([message('Search failed — check your connection')]);
        }
    }

    function goToLocation(lat, lon, name) {
        hideResults();
        input.value = name.split(',').slice(0, 2).join(',');
        map.flyTo([lat, lon], 12, { duration: 1.5 });

        // Auto-trigger the intensity calculation once the map has arrived
        setTimeout(() => {
            map.fire('click', { latlng: L.latLng(lat, lon) });
        }, 1800);
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            searchLocation();
        } else if (e.key === 'Escape') {
            hideResults();
        }
    });

    // Close search results when clicking elsewhere
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search')) hideResults();
    });

    // ============================================
    // PANEL TABS — Layers / Legend / About
    // ============================================
    const tabs = Array.from(document.querySelectorAll('.tabs [role="tab"]'));

    function selectTab(tab) {
        tabs.forEach((t) => {
            const on = t === tab;
            t.setAttribute('aria-selected', on);
            t.tabIndex = on ? 0 : -1;
            document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
        });
    }

    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => selectTab(tab));
        // Left/right arrow keys move between tabs
        tab.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
            selectTab(next);
            next.focus();
        });
    });

    // ============================================
    // PANEL COLLAPSE
    // ============================================
    const app = document.getElementById('app');
    const panel = document.getElementById('side-panel');
    const collapseBtn = document.getElementById('panel-collapse');

    collapseBtn.addEventListener('click', () => {
        const collapsed = app.classList.toggle('collapsed');
        collapseBtn.setAttribute('aria-expanded', !collapsed);
        collapseBtn.setAttribute('aria-label', collapsed ? 'Show panel' : 'Hide panel');
        panel.inert = collapsed;   // keep keyboard focus out of the hidden panel
        // The map area changed size: let Leaflet re-measure after the slide (0.25s)
        setTimeout(() => map.invalidateSize(), 300);
    });

    // ============================================
    // MAP BUTTONS — zoom, reset view, my location
    // ============================================
    const toast = document.getElementById('map-toast');
    let toastTimer = null;

    function showToast(text, ms = 3500) {
        toast.textContent = text;
        toast.hidden = false;
        clearTimeout(toastTimer);
        if (ms) toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
    }

    document.getElementById('zoom-in').addEventListener('click', () => map.zoomIn());
    document.getElementById('zoom-out').addEventListener('click', () => map.zoomOut());
    document.getElementById('reset-view').addEventListener('click', () => {
        map.flyTo(STUDY_VIEW.center, STUDY_VIEW.zoom, { duration: 1 });
    });

    let locationMarker = null;
    document.getElementById('locate-me').addEventListener('click', () => {
        showToast('Finding your location…', 0);
        map.locate({ setView: true, maxZoom: 12 });
    });

    map.on('locationfound', (e) => {
        toast.hidden = true;
        if (locationMarker) map.removeLayer(locationMarker);
        locationMarker = L.marker(e.latlng, {
            icon: L.divIcon({ className: 'location-dot', iconSize: [16, 16] }),
            keyboard: false,
            title: 'Your location'
        }).addTo(map);
    });

    map.on('locationerror', () => {
        showToast('Couldn\'t get your location — check your browser\'s location permission.');
    });

    // ============================================
    // HINT — hidden after the first map click
    // ============================================
    const hint = document.getElementById('map-hint');
    map.once('click', () => { hint.hidden = true; });
})();
