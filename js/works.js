(() => {
  'use strict';

  const gallery = document.querySelector('.works-gallery');
  if (!gallery) return;
  const tiles = Array.from(gallery.querySelectorAll('.work-tile'));
  const ratios = tiles.map(tile => Number(tile.dataset.ratio));
  const featured = tiles.map(tile => tile.dataset.featured === 'true');
  const preferCompact = tiles.map(tile => tile.dataset.compact === 'true');
  if (ratios.some(ratio => !Number.isFinite(ratio) || ratio <= 0)) return;
  let lastWidth = 0;

  function layout() {
    const width = gallery.clientWidth;
    if (!width || width === lastWidth) return;
    lastWidth = width;
    const gap = parseFloat(getComputedStyle(gallery).gap) || 0;
    const compact = width < 600;
    const regularTarget = compact ? 130 : width < 1100 ? 205 : 230;
    const featuredTarget = compact ? 220 : width < 1100 ? 300 : 350;
    const minFeaturedHeight = compact ? 0 : regularTarget * 1.1;
    const minPortraitHeight = !compact && width < 1100 ? regularTarget * 1.35 : minFeaturedHeight;
    const maxItems = width < 600 ? 2 : 6;
    const maxFeaturedItems = compact ? 1 : 3;
    const costs = Array(tiles.length + 1).fill(Infinity);
    const ends = Array(tiles.length);
    costs[tiles.length] = 0;

    // Give selected projects more room while keeping the sequence and full images.
    // On compact screens, only a portrait pair may share a selected project's row.
    for (let start = tiles.length - 1; start >= 0; start--) {
      let sum = 0;
      let hasFeatured = false;
      let hasFeaturedPortrait = false;
      let hasCompactTile = false;
      for (let end = start; end < Math.min(tiles.length, start + maxItems); end++) {
        sum += ratios[end];
        hasFeatured = hasFeatured || featured[end];
        hasFeaturedPortrait = hasFeaturedPortrait || (featured[end] && ratios[end] < 1);
        hasCompactTile = hasCompactTile || preferCompact[end];
        const portraitPair = compact && end === start + 1 &&
          ratios[start] < 1 && ratios[end] < 1 && featured[start] !== featured[end];
        if (hasFeatured && end - start + 1 > maxFeaturedItems && !portraitPair) break;
        const target = hasFeatured ? featuredTarget : regularTarget;
        const height = (width - gap * (end - start)) / sum;
        // Keep selected projects visible when rows regroup at nearby widths.
        const minimum = hasFeaturedPortrait ? minPortraitHeight : minFeaturedHeight;
        if (hasFeatured && height < minimum) break;
        const deviation = (height - target) / target;
        // Prefer a shorter row for compact tiles without making the row impossible.
        const excessHeight = hasCompactTile ? Math.max(0, height / regularTarget - 1) : 0;
        const cost = deviation * deviation + 3 * excessHeight * excessHeight + costs[end + 1];
        if (cost < costs[start]) {
          costs[start] = cost;
          ends[start] = end + 1;
        }
      }
    }

    let top = 0;
    for (let start = 0; start < tiles.length;) {
      const end = ends[start];
      const sum = ratios.slice(start, end).reduce((total, ratio) => total + ratio, 0);
      const height = (width - gap * (end - start - 1)) / sum;
      let left = 0;
      for (let index = start; index < end; index++) {
        const tile = tiles[index];
        const tileWidth = height * ratios[index];
        tile.style.position = 'absolute';
        tile.style.width = `${tileWidth}px`;
        tile.style.left = `${left}px`;
        tile.style.top = `${top}px`;
        left += tileWidth + gap;
      }
      top += height + gap;
      start = end;
    }
    gallery.style.position = 'relative';
    gallery.style.display = 'block';
    gallery.style.height = `${Math.max(0, top - gap)}px`;
  }

  layout();
  if ('ResizeObserver' in window) {
    new ResizeObserver(layout).observe(gallery);
  } else {
    window.addEventListener('resize', layout);
  }

  const menuButton = document.querySelector('#menubar_hdr');
  const menu = document.querySelector('#menubar');
  if (menuButton && menu) {
    function toggleMenu(open) {
      menu.classList.toggle('db', open);
      menu.classList.toggle('dn', !open);
      menuButton.classList.toggle('ham', open);
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
    menuButton.addEventListener('click', () => {
      toggleMenu(menuButton.getAttribute('aria-expanded') !== 'true');
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
        toggleMenu(false);
        menuButton.focus();
      }
    });
  }
})();
