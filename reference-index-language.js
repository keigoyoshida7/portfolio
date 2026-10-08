'use strict';

// English titles are present in the saved HTML so the index is also readable
// without JavaScript. The original title and canonical source URL stay attached.
(() => {
  let locale = 'en';
  try { if (localStorage.getItem('latent-reference-language') === 'ja') locale = 'ja'; } catch {}
  function setLanguage(next, persist = true) {
    if (next !== 'en' && next !== 'ja') return;
    locale = next;
    const titles = document.documentElement.dataset;
    const title = locale === 'en' ? titles.referenceTitleEn : titles.referenceTitleJa;
    if (title) document.title = title;
    document.documentElement.lang = locale;
    if (persist) { try { localStorage.setItem('latent-reference-language', locale); } catch {} }
    document.querySelectorAll('[data-reference-en]').forEach(node => {
      node.textContent = locale === 'ja' ? node.dataset.referenceJa : node.dataset.referenceEn;
      node.lang = locale;
    });
    document.querySelectorAll('[data-reference-locale]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.referenceLocale === locale));
    });
    document.querySelectorAll('[data-reference-language]').forEach(node => {
      node.hidden = node.dataset.referenceLanguage !== locale;
    });
    document.querySelectorAll('[data-reference-aria-en]').forEach(node => {
      node.setAttribute('aria-label', locale === 'ja' ? node.dataset.referenceAriaJa : node.dataset.referenceAriaEn);
    });
  }
  document.querySelectorAll('[data-reference-locale]').forEach(button => {
    button.addEventListener('click', () => setLanguage(button.dataset.referenceLocale));
  });
  window.addEventListener('storage', event => {
    if (event.key === 'latent-reference-language') setLanguage(event.newValue, false);
  });
  setLanguage(locale, false);
})();
