'use strict';

// Render the source note as text and links, never as executable HTML.
window.LatentReferenceLinks = (() => {
  const tokenPattern = /`[^`\n]*`|\[[^\]\n]*\]|https?:\/\/[^\s<>\[\]`]+/gi;
  const projectPattern = /^[a-z0-9_.-]+$/i;
  const schemePattern = /(?:^|\s)[a-z][a-z0-9+.-]*:/i;

  function safeUrl(value) {
    if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020<>`]/u.test(value)) return null;
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.href : null;
    } catch { return null; }
  }

  function bareUrlParts(value) {
    let url = value;
    // Keep sentence punctuation outside the link, but retain balanced URL
    // parentheses such as Wikipedia's /Flow_(psychology).
    while (url && /[.,;:!?，。；：！？、」』）”’"']$/u.test(url)) url = url.slice(0, -1);
    while (url.endsWith(')') && (url.match(/\)/g) || []).length > (url.match(/\(/g) || []).length) url = url.slice(0, -1);
    return [url, value.slice(url.length)];
  }

  function internalUrl(title, source) {
    if (!title || title.startsWith('#') || schemePattern.test(title) || /^[*`!\-]/u.test(title)) return null;
    try {
      if (title.startsWith('/')) {
        const parts = title.slice(1).split('/');
        if (!projectPattern.test(parts[0]) || parts[0] === '.' || parts[0] === '..') return null;
        const project = parts.shift();
        return `https://scrapbox.io/${encodeURIComponent(project)}${parts.length ? '/' + encodeURIComponent(parts.join('/')) : ''}`;
      }
      if (!projectPattern.test(source) || source === '.' || source === '..') return null;
      return `https://scrapbox.io/${encodeURIComponent(source)}/${encodeURIComponent(title)}`;
    } catch { return null; }
  }

  function bracketLink(token, source) {
    const content = token.slice(1, -1).trim();
    const first = content.match(/^(https?:\/\/\S+)(?:\s+([\s\S]+))?$/i);
    if (first) {
      const href = safeUrl(first[1]);
      return href ? {href, label: first[2] || first[1]} : null;
    }
    const last = content.match(/^([\s\S]+?)\s+(https?:\/\/\S+)$/i);
    if (last) {
      const href = safeUrl(last[2]);
      return href ? {href, label: last[1]} : null;
    }
    // Treat unsupported markup and non-HTTP schemes as literal source text.
    // An HTTP URL in malformed markup must not become a made-up page title.
    if (/https?:\/\//i.test(content)) return null;
    const href = internalUrl(content, String(source || ''));
    return href ? {href, label: content} : null;
  }

  function append(container, text, source) {
    const doc = container.ownerDocument || document;
    const input = String(text ?? '');
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    const addText = value => { if (value) fragment.appendChild(doc.createTextNode(value)); };
    const addLink = (href, label) => {
      const link = doc.createElement('a');
      link.className = 'reference-text-link';
      link.href = href;
      link.textContent = label;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = href;
      fragment.appendChild(link);
    };
    for (const match of input.matchAll(tokenPattern)) {
      addText(input.slice(cursor, match.index));
      const token = match[0];
      if (token.startsWith('[')) {
        const link = bracketLink(token, source);
        if (link) addLink(link.href, link.label); else addText(token);
      } else if (/^https?:\/\//i.test(token)) {
        const [url, punctuation] = bareUrlParts(token);
        const href = safeUrl(url);
        if (href) { addLink(href, url); addText(punctuation); } else addText(token);
      } else addText(token);
      cursor = match.index + token.length;
    }
    addText(input.slice(cursor));
    container.appendChild(fragment);
    return container;
  }

  return Object.freeze({append});
})();
