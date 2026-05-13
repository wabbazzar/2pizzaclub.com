(function () {
    'use strict';

    const links = Array.from(document.querySelectorAll('.timeline-list a[data-anchor]'));
    if (!links.length) return;

    const anchorToLink = new Map();
    for (const a of links) anchorToLink.set(a.dataset.anchor, a);

    const sections = Array.from(document.querySelectorAll('[id^="y"][data-anchor]'));

    let activeAnchor = null;
    function setActive(anchor) {
        if (anchor === activeAnchor) return;
        if (activeAnchor) {
            const prev = anchorToLink.get(activeAnchor);
            if (prev) prev.classList.remove('is-active');
        }
        activeAnchor = anchor;
        if (anchor) {
            const next = anchorToLink.get(anchor);
            if (next) next.classList.add('is-active');
        }
    }

    const observer = new IntersectionObserver(
        (entries) => {
            const visible = entries
                .filter((e) => e.isIntersecting)
                .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
            if (visible.length) {
                setActive(visible[0].target.dataset.anchor);
            }
        },
        { rootMargin: '-30% 0px -55% 0px', threshold: 0 }
    );
    for (const s of sections) observer.observe(s);

    const toggle = document.querySelector('.timeline-toggle');
    const rail = document.querySelector('.timeline');
    if (toggle && rail) {
        toggle.addEventListener('click', () => {
            const open = rail.classList.toggle('is-open');
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        for (const a of links) {
            a.addEventListener('click', () => {
                if (rail.classList.contains('is-open')) {
                    rail.classList.remove('is-open');
                    toggle.setAttribute('aria-expanded', 'false');
                }
            });
        }
    }
})();
