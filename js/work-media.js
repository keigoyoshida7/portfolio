(() => {
  'use strict';

  // Keep separate performances from playing over one another.
  document.addEventListener('play', event => {
    if (!(event.target instanceof HTMLVideoElement)) return;
    for (const video of document.querySelectorAll('.work-video video')) {
      if (video !== event.target) video.pause();
    }
  }, true);
})();
