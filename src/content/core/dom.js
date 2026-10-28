/* Garry AutoFill - DOM helpers: shadow-DOM aware traversal, visibility, label/question/section text. */
(function () {
  'use strict';
  const GAF = (globalThis.GAF = globalThis.GAF || {});
  if (GAF.dom) return;
  const { cleanLabel, cssEscape, isTestEnv } = GAF.util;

  const UI_ATTR = 'data-gaf-ui';

  function shadowRootOf(el) {
    try {
      if (globalThis.chrome && chrome.dom && typeof chrome.dom.openOrClosedShadowRoot === 'function') {
        return chrome.dom.openOrClosedShadowRoot(el) || null;
      }
    } catch (_) { /* not an element with a shadow root */ }
    return el.shadowRoot || null;
  }

  /** Parent that crosses shadow boundaries (shadow root -> host). */
  function parentComposed(node) {
    if (!node) return null;
    if (node.assignedSlot) return node.assignedSlot;
    if (node.parentElement) return node.parentElement;
    const p = node.parentNode;
    if (p && p.nodeType === 11 && p.host) return p.host; // ShadowRoot
    return null;
  }

  /** Walks elements in (approximate) composed order, descending into shadow roots at the host position. */
  function walkDeep(root, visit) {
    const doc = root.ownerDocument || root;
    // FILTER_REJECT (2) skips our own UI subtree entirely; FILTER_ACCEPT (1) otherwise.
    const filter = { acceptNode: (n) => (n.hasAttribute && n.hasAttribute(UI_ATTR) ? 2 : 1) };
    const walkRoot = (r) => {
      const tw = doc.createTreeWalker(r, 1 /* SHOW_ELEMENT */, filter);
      let n = tw.nextNode();
      while (n) {
        if (visit(n) === false) return false;
        const sr = shadowRootOf(n);
        if (sr && walkRoot(sr) === false) return false;
        n = tw.nextNode();
      }
      return true;
    };
    if (root.nodeType === 1) {
      if (visit(root) === false) return;
      const sr = shadowRootOf(root);
      if (sr && walkRoot(sr) === false) return;
    }
    walkRoot(root);
  }

  function deepQueryAll(selector, root) {
    const out = [];
    walkDeep(root || document, (el) => {
      try { if (el.matches(selector)) out.push(el); } catch (_) { /* invalid selector for this el */ }
    });
    return out;
  }

  function deepQuery(selector, root) {
    let found = null;
    walkDeep(root || document, (el) => {
      try { if (el.matches(selector)) { found = el; return false; } } catch (_) { /* ignore */ }
      return true;
    });
    return found;
  }

  /** Map element -> sequential index in composed order (for ordering fields/headings across shadow roots). */
  function orderIndex(root) {
    const map = new Map();
    let i = 0;
    walkDeep(root || document, (el) => { map.set(el, i++); });
    return map;
  }

  function closestComposed(el, selector) {
    for (let n = el; n; n = parentComposed(n)) {
      if (n.nodeType === 1) {
        try { if (n.matches(selector)) return n; } catch (_) { return null; }
      }
    }
    return null;
  }

  function winOf(el) {
    return (el && el.ownerDocument && el.ownerDocument.defaultView) || globalThis;
  }

  function styleOf(el) {
    try { return winOf(el).getComputedStyle(el); } catch (_) { return null; }
  }

  /** True when the element is rendered and not hidden by CSS. */
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (isTestEnv()) {
      for (let n = el; n; n = parentComposed(n)) {
        if (n.nodeType !== 1) continue;
        if (n.hidden) return false;
        const cs = styleOf(n);
        if (cs && (cs.display === 'none' || (n === el && cs.visibility === 'hidden'))) return false;
      }
      return true;
    }
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ checkVisibilityCSS: true })) return false;
    } else {
      const cs = styleOf(el);
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    }
    const rects = el.getClientRects();
    if (!rects || rects.length === 0) return false;
    return true;
  }

  /** Visible, or a visually-hidden native control (custom-styled radio/checkbox/file) whose label/container is visible. */
  function isInteractable(el) {
    if (isVisible(el)) return true;
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'INPUT' && (type === 'radio' || type === 'checkbox' || type === 'file')) {
      if (el.labels && Array.from(el.labels).some(isVisible)) return true;
      const p = parentComposed(el);
      if (p && isVisible(p)) return true;
      if (type === 'file') {
        const zone = closestComposed(el, '[class*="drop" i], [class*="upload" i], [data-automation-id*="upload" i]');
        if (zone && isVisible(zone)) return true;
      }
    }
    if (tag === 'SELECT') {
      // enhanced selects (select2/chosen/iCIMS) hide the native <select> but show a sibling widget
      const p = parentComposed(el);
      if (p && isVisible(p) && styleOf(el) && styleOf(el).display !== 'none') return true;
      const sib = el.nextElementSibling;
      if (sib && /select2|chosen|selectize|dropdown|combobox/i.test(sib.className || '') && isVisible(sib)) return true;
    }
    return false;
  }

  const SKIP_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SELECT', 'OPTION', 'DATALIST', 'SVG', 'svg', 'IFRAME', 'TEXTAREA', 'INPUT']);

  /**
   * Visible text of a node. Uses innerText in real browsers; a filtered textContent walk otherwise.
   * `exclude` is a Set of elements whose subtree text must be ignored.
   */
  function textOf(node, exclude) {
    if (!node) return '';
    if (!exclude && typeof node.innerText === 'string' && !isTestEnv()) {
      return node.innerText.replace(/\s+/g, ' ').trim();
    }
    let out = '';
    const visit = (n) => {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1 && n.nodeType !== 11) return;
      if (n.nodeType === 1) {
        if (exclude && exclude.has(n)) return;
        if (SKIP_TEXT_TAGS.has(n.tagName)) return;
        if (n.hasAttribute(UI_ATTR)) return;
        if (n.hidden) return;
        if (!isTestEnv()) {
          const cs = styleOf(n);
          if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return;
        } else if (n.style && n.style.display === 'none') return;
        if (/^(BR|P|DIV|LI|H[1-6]|TR|LABEL|LEGEND)$/.test(n.tagName)) out += ' ';
      }
      for (let c = n.firstChild; c; c = c.nextSibling) visit(c);
    };
    visit(node);
    return out.replace(/\s+/g, ' ').trim();
  }

  function byIdInRoot(el, id) {
    const rootNode = el.getRootNode ? el.getRootNode() : document;
    if (rootNode.getElementById) return rootNode.getElementById(id);
    try { return rootNode.querySelector('#' + cssEscape(id)); } catch (_) { return null; }
  }

  const CONTROL_SELECTOR = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])',
    'select', 'textarea', '[role="combobox"]', '[role="listbox"]', '[role="radiogroup"]', '[role="checkbox"]', '[role="switch"]',
    'button[aria-haspopup="listbox"]', '[contenteditable="true"]',
  ].join(',');

  function labelTextOf(labelEl) {
    const exclude = new Set(labelEl.querySelectorAll ? labelEl.querySelectorAll('select, textarea, [role="listbox"], [role="option"], ul[role]') : []);
    return textOf(labelEl, exclude.size ? exclude : null);
  }

  /** Text from aria-labelledby, <label>, aria-label, placeholder... (the field's own label, not group question). */
  function ownLabel(el) {
    const lb = el.getAttribute && el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => byIdInRoot(el, id)).filter((n) => n && n !== el).map((n) => labelTextOf(n)).join(' ');
      if (t.trim()) return cleanLabel(t);
    }
    let labels = [];
    try { labels = el.labels ? Array.from(el.labels) : []; } catch (_) { labels = []; }
    if (!labels.length && el.id) {
      const rootNode = el.getRootNode ? el.getRootNode() : document;
      try { labels = Array.from(rootNode.querySelectorAll('label[for="' + cssEscape(el.id) + '"]')); } catch (_) { labels = []; }
    }
    if (labels.length) {
      const t = labels.map(labelTextOf).join(' ');
      if (t.trim()) return cleanLabel(t);
    }
    const al = el.getAttribute && el.getAttribute('aria-label');
    if (al && al.trim()) return cleanLabel(al);
    // Web components: input inside a shadow root labelled by host attributes.
    const rn = el.getRootNode && el.getRootNode();
    if (rn && rn.host) {
      const host = rn.host;
      const hl = host.getAttribute('label') || host.getAttribute('aria-label') || host.getAttribute('placeholder');
      if (hl) return cleanLabel(hl);
      const hostLabel = ownLabel(host);
      if (hostLabel) return hostLabel;
    }
    return '';
  }

  function countControls(container) {
    let n = 0;
    try {
      container.querySelectorAll(CONTROL_SELECTOR).forEach((c) => {
        if (c.closest('[role="listbox"]') && c.getAttribute('role') !== 'listbox') return;
        n++;
      });
    } catch (_) { /* ignore */ }
    return n;
  }

  /**
   * Label for fields without an explicit <label>: climbs up while the container holds only this control
   * (or only the given group members) and returns the container's text minus the controls' own texts.
   */
  function containerText(el, members, opts) {
    const memberSet = new Set(members || [el]);
    let prev = el;
    for (let depth = 0; depth < 7; depth++) {
      const node = parentComposed(prev);
      if (!node || node.nodeType !== 1 || node.tagName === 'BODY' || node.tagName === 'FORM' || node.tagName === 'HTML') break;
      const controls = countControls(node);
      if (controls > memberSet.size) {
        // the container is shared with other fields; the best text is a label-like previous sibling of `prev`
        return opts && opts.noSibling ? '' : previousSiblingLabel(prev);
      }
      const exclude = new Set();
      memberSet.forEach((m) => {
        exclude.add(m);
        try { (m.labels ? Array.from(m.labels) : []).forEach((l) => { if (members) exclude.add(l); }); } catch (_) { /* ignore */ }
      });
      node.querySelectorAll('[role="listbox"], [role="option"], ul[role], [aria-live], [role="alert"], [class*="error" i]').forEach((x) => exclude.add(x));
      const t = cleanLabel(textOf(node, exclude));
      if (t && t.length <= 400) return t;
      if (t && t.length > 400) return cleanLabel(t.slice(0, 400));
      prev = node;
    }
    return '';
  }

  function previousSiblingLabel(node) {
    let s = node.previousElementSibling;
    for (let i = 0; s && i < 3; i++, s = s.previousElementSibling) {
      if (countControls(s) > 0) return '';
      const t = cleanLabel(textOf(s));
      if (t) return t.length > 400 ? t.slice(0, 400) : t;
    }
    return '';
  }

  /** Full label for a single control: own label, then container text, then placeholder/title. */
  function labelFor(el) {
    let t = ownLabel(el);
    if (!t) t = containerText(el);
    if (!t) t = cleanLabel(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('data-placeholder') || '');
    return t;
  }

  /** Question text for a radio/checkbox group. */
  function groupQuestion(members) {
    const first = members[0];
    const fs = closestComposed(first, 'fieldset');
    if (fs && members.every((m) => fs.contains(m))) {
      const legend = fs.querySelector('legend');
      if (legend && textOf(legend)) return cleanLabel(textOf(legend));
    }
    const grp = closestComposed(first, '[role="radiogroup"], [role="group"]');
    if (grp && members.every((m) => grp.contains(m))) {
      const t = ownLabel(grp);
      if (t) return t;
    }
    return containerText(first, members);
  }

  const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, legend, [role="heading"], [data-automation-id*="Heading" i], [data-automation-id*="sectionHeader" i], [class*="section-title" i], [class*="sectionTitle" i], [class*="section-header" i], [class*="application-section" i] > h3';

  /** Headings in composed order, for section lookup. */
  function collectHeadings(root, order) {
    return deepQueryAll(HEADING_SELECTOR, root || document)
      .filter((h) => !h.closest || !h.closest('[' + UI_ATTR + ']'))
      .map((h) => ({ el: h, idx: order.get(h), text: cleanLabel(textOf(h)) }))
      .filter((h) => h.text && h.text.length < 120 && h.idx != null)
      .sort((a, b) => a.idx - b.idx);
  }

  /** Nearest preceding headings (up to 2, nearest first) for an element index. */
  function sectionFor(idx, headings) {
    let lo = 0; let hi = headings.length - 1; let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (headings[mid].idx < idx) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const out = [];
    for (let i = best; i >= 0 && out.length < 3; i--) out.push(headings[i].text);
    return out;
  }

  function scrollIntoViewIfNeeded(el) {
    try {
      if (isTestEnv()) return;
      const r = el.getBoundingClientRect();
      const vh = winOf(el).innerHeight;
      if (r.top < 0 || r.bottom > vh) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_) { /* ignore */ }
  }

  function attrText(el) {
    const bits = [];
    ['name', 'id', 'autocomplete', 'data-automation-id', 'data-qa', 'data-testid', 'data-test', 'data-field', 'formcontrolname', 'ng-model', 'data-bind', 'class']
      .forEach((a) => {
        const v = el.getAttribute && el.getAttribute(a);
        if (v && !(a === 'class' && v.length > 200)) bits.push(v);
      });
    const rn = el.getRootNode && el.getRootNode();
    if (rn && rn.host) ['name', 'id', 'data-automation-id', 'label'].forEach((a) => { const v = rn.host.getAttribute(a); if (v) bits.push(v); });
    return GAF.util.humanizeAttr(bits.join(' '));
  }

  GAF.dom = {
    UI_ATTR, CONTROL_SELECTOR, HEADING_SELECTOR,
    shadowRootOf, parentComposed, walkDeep, deepQueryAll, deepQuery, orderIndex, closestComposed,
    winOf, styleOf, isVisible, isInteractable, textOf, ownLabel, labelFor, containerText, groupQuestion,
    collectHeadings, sectionFor, scrollIntoViewIfNeeded, attrText, byIdInRoot, countControls,
  };
})();
