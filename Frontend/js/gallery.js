/**
 * gallery.js — Gallery page only (gallery.html).
 * Builds one section per trip from GALLERY_TRIPS (js/gallery-data.js)
 * and runs the photo lightbox. Trip data lives in gallery-data.js — no
 * need to edit this file to add trips or photos.
 */
(function () {
    const container = document.getElementById('trips');
    const lightbox = document.getElementById('lightbox');
    if (!container || !lightbox || typeof GALLERY_TRIPS === 'undefined') return;

    const PHOTO_ROOT = 'images/activities/';
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];

    // ---- Helpers ----
    function photoSrc(trip, n) {
        return PHOTO_ROOT + trip.folder + '/' + String(n).padStart(2, '0') + '.jpg';
    }

    // "2026-06-marinduque" -> "June 2026" (falls back to the dates text)
    function monthYear(trip) {
        const match = /^(\d{4})-(\d{2})/.exec(trip.folder);
        return match ? MONTHS[Number(match[2]) - 1] + ' ' + match[1] : trip.dates;
    }

    function altText(trip, n) {
        return trip.location + ', ' + monthYear(trip) + ', photo ' + n;
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    // ---- Trip sections ----
    function renderTrip(trip, index) {
        // Alternate white / cream backgrounds like the other pages
        const section = el('section', 'section trip ' + (index % 2 === 0 ? 'section-white' : 'section-cream'));
        const wrap = el('div', 'container');

        const head = el('div', 'trip-head');
        head.append(el('h2', 'trip-title', trip.location));
        head.append(el('p', 'trip-dates', trip.dates));
        if (trip.description) head.append(el('p', 'trip-desc', trip.description));
        head.append(el('p', 'trip-count', trip.photos === 1 ? '1 photo' : trip.photos + ' photos'));
        wrap.append(head);

        if (trip.photos > 0) {
            const grid = el('ul', 'trip-grid');
            for (let n = 1; n <= trip.photos; n++) {
                const thumb = el('button', 'trip-thumb');
                thumb.type = 'button';
                thumb.dataset.trip = index;
                thumb.dataset.photo = n;

                const img = el('img');
                img.loading = 'lazy';          // set before src so the browser defers it
                img.decoding = 'async';
                img.alt = altText(trip, n);
                img.src = photoSrc(trip, n);

                thumb.append(img);
                const item = el('li');
                item.append(thumb);
                grid.append(item);
            }
            wrap.append(grid);
        } else {
            wrap.append(el('div', 'coming-soon trip-empty', 'Photos coming soon'));
        }

        section.append(wrap);
        return section;
    }

    GALLERY_TRIPS.forEach((trip, index) => container.append(renderTrip(trip, index)));

    // ---- Lightbox ----
    const lbImg = document.getElementById('lightbox-img');
    const lbTitle = document.getElementById('lightbox-title');
    const lbCounter = document.getElementById('lightbox-counter');
    const lbStage = document.getElementById('lightbox-stage');
    const prevBtn = document.getElementById('lightbox-prev');
    const nextBtn = document.getElementById('lightbox-next');
    const closeBtn = document.getElementById('lightbox-close');

    let current = { trip: null, photo: 1 };
    let returnFocusTo = null;

    function show() {
        const trip = current.trip;
        lbImg.src = photoSrc(trip, current.photo);
        lbImg.alt = altText(trip, current.photo);
        lbTitle.textContent = trip.location + ' · ' + trip.dates;
        lbCounter.textContent = current.photo + ' / ' + trip.photos;
        const single = trip.photos < 2;
        prevBtn.hidden = single;
        nextBtn.hidden = single;
    }

    function open(tripIndex, photo, trigger) {
        current = { trip: GALLERY_TRIPS[tripIndex], photo: photo };
        returnFocusTo = trigger;
        show();
        lightbox.hidden = false;
        document.documentElement.classList.add('lightbox-open');   // stop the page scrolling behind
        closeBtn.focus();
    }

    function close() {
        lightbox.hidden = true;
        document.documentElement.classList.remove('lightbox-open');
        lbImg.removeAttribute('src');
        if (returnFocusTo) returnFocusTo.focus();
    }

    // Move within the current trip, wrapping from the last photo to the first
    function step(direction) {
        const total = current.trip.photos;
        current.photo = ((current.photo - 1 + direction + total) % total) + 1;
        show();
    }

    container.addEventListener('click', (event) => {
        const thumb = event.target.closest('.trip-thumb');
        if (thumb) open(Number(thumb.dataset.trip), Number(thumb.dataset.photo), thumb);
    });

    prevBtn.addEventListener('click', () => step(-1));
    nextBtn.addEventListener('click', () => step(1));
    closeBtn.addEventListener('click', close);

    // Clicking the dark backdrop (not the photo or buttons) closes it
    lightbox.addEventListener('click', (event) => {
        if (event.target === lightbox || event.target === lbStage) close();
    });

    document.addEventListener('keydown', (event) => {
        if (lightbox.hidden) return;
        if (event.key === 'Escape') {
            close();
        } else if (event.key === 'ArrowLeft' && !prevBtn.hidden) {
            step(-1);
        } else if (event.key === 'ArrowRight' && !nextBtn.hidden) {
            step(1);
        } else if (event.key === 'Tab') {
            // Keep keyboard focus inside the lightbox
            const focusable = [closeBtn, prevBtn, nextBtn].filter((b) => !b.hidden);
            const i = focusable.indexOf(document.activeElement);
            const next = event.shiftKey ? i - 1 : i + 1;
            focusable[(next + focusable.length) % focusable.length].focus();
            event.preventDefault();
        }
    });

    // Swipe left/right on touch screens
    let touchStart = null;
    lightbox.addEventListener('touchstart', (event) => {
        const t = event.changedTouches[0];
        touchStart = { x: t.clientX, y: t.clientY };
    }, { passive: true });

    lightbox.addEventListener('touchend', (event) => {
        if (!touchStart || nextBtn.hidden) return;
        const t = event.changedTouches[0];
        const dx = t.clientX - touchStart.x;
        const dy = t.clientY - touchStart.y;
        touchStart = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    }, { passive: true });
})();
