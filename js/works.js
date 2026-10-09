(() => {
  'use strict';

  const gallery = document.querySelector('.works-gallery');
  if (!gallery) return;
  const tiles = Array.from(gallery.querySelectorAll('.work-tile'));
  const ratios = tiles.map(tile => Number(tile.dataset.ratio));
  if (ratios.some(ratio => !Number.isFinite(ratio) || ratio <= 0)) return;
  let lastWidth = 0;

  function layout() {
    const width = gallery.clientWidth;
    if (!width || width === lastWidth) return;
    lastWidth = width;
    const gap = parseFloat(getComputedStyle(gallery).gap) || 0;
    const target = width < 600 ? 190 : width < 1100 ? 250 : 300;
    const maxItems = width < 600 ? 2 : 6;
    const costs = Array(tiles.length + 1).fill(Infinity);
    const ends = Array(tiles.length);
    costs[tiles.length] = 0;

    // Balance the whole sequence, including the last row, so every row fills
    // the available width. Only widths change; image heights stay automatic.
    for (let start = tiles.length - 1; start >= 0; start--) {
      let sum = 0;
      for (let end = start; end < Math.min(tiles.length, start + maxItems); end++) {
        sum += ratios[end];
        const height = (width - gap * (end - start)) / sum;
        const deviation = (height - target) / target;
        const cost = deviation * deviation + costs[end + 1];
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
