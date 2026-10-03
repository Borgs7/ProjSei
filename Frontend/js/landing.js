/**
 * landing.js — homepage only (index.html).
 * Wires the Gallery ‹ › buttons to scroll the horizontal photo row.
 * The row still scrolls by swipe/trackpad if this script doesn't load.
 */
(function () {
    const track = document.getElementById('gallery-track');
    const prevBtn = document.getElementById('gallery-prev');
    const nextBtn = document.getElementById('gallery-next');
    if (!track || !prevBtn || !nextBtn) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Scroll by one tile (tile width + gap)
    function stepSize() {
        const item = track.querySelector('.gallery-item');
        const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
        return item ? item.getBoundingClientRect().width + gap : track.clientWidth * 0.8;
    }

    function scrollByStep(direction) {
        track.scrollBy({ left: direction * stepSize(), behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    // Disable a button when the row can't scroll further that way
    function updateButtons() {
        const maxScroll = track.scrollWidth - track.clientWidth - 1;
        prevBtn.disabled = track.scrollLeft <= 1;
        nextBtn.disabled = track.scrollLeft >= maxScroll;
    }

    prevBtn.addEventListener('click', () => scrollByStep(-1));
    nextBtn.addEventListener('click', () => scrollByStep(1));
    track.addEventListener('scroll', updateButtons, { passive: true });
    window.addEventListener('resize', updateButtons);
    updateButtons();
})();
