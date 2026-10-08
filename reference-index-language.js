'use strict';

// English titles are present in the saved HTML so the index is also readable
// without JavaScript. The original title and canonical source URL stay attached.
(() => {
  let locale = 'en';
  try { if (localStorage.getItem('latent-reference-language') === 'ja') locale = 'ja'; } catch {}
  function setLanguage(next) {
    if (next !== 'en' && next !== 'ja') return;
    locale = next;
    document.title = locale === 'en' ? 'Latent References — Reference index | Keigo Yoshida' : 'Latent References — 索引 | 吉田慧悟 / Keigo Yoshida';
    try { localStorage.setItem('latent-reference-language', locale); } catch {}
    document.querySelectorAll('[data-reference-en]').forEach(node => {
      node.textContent = locale === 'ja' ? node.dataset.referenceJa : node.dataset.referenceEn;
      node.lang = locale;
    });
    document.querySelectorAll('[data-reference-locale]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.referenceLocale === locale));
    });
  }
  document.querySelectorAll('[data-reference-locale]').forEach(button => {
    button.addEventListener('click', () => setLanguage(button.dataset.referenceLocale));
  });
  setLanguage(locale);
})();
