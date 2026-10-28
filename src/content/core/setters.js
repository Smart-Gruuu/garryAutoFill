/*
 * Garry AutoFill - low-level interaction primitives that make framework-driven forms
 * (React, Angular, Vue, Knockout, jQuery plugins, web components) register programmatic input.
 *
 * SAFETY: nothing in here may submit an application. `safeClick` refuses submit-like buttons and every
 * interaction runs under a capturing submit guard that cancels accidental form submission.
 */
(function () {
  'use strict';
  const GAF = (globalThis.GAF = globalThis.GAF || {});
  if (GAF.set) return;
  const { sleep, waitFor, normalize, isTestEnv } = GAF.util;
  const { winOf, isVisible, textOf, closestComposed, scrollIntoViewIfNeeded } = GAF.dom;

  // ---------------------------------------------------------------------------------------------
  // Events

  function fire(el, type, init) {
    const win = winOf(el);
    const base = Object.assign({ bubbles: true, cancelable: true, composed: true }, init || {});
    let ev;
    try {
      if (/^key/.test(type)) ev = new win.KeyboardEvent(type, base);
      else if (/^pointer/.test(type) && win.PointerEvent) ev = new win.PointerEvent(type, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true, view: win }, base));
      else if (/^(mouse|click|dblclick|contextmenu)|^pointer/.test(type)) ev = new win.MouseEvent(type, Object.assign({ view: win, button: 0 }, base));
      else if (type === 'input' || type === 'beforeinput') {
        ev = win.InputEvent
          ? new win.InputEvent(type, Object.assign({ inputType: 'insertText', data: null }, base, { cancelable: type === 'beforeinput' }))
          : new win.Event(type, base);
      } else if (type === 'focus' || type === 'blur') ev = new win.FocusEvent(type, Object.assign({}, base, { bubbles: false, cancelable: false }));
      else if (type === 'focusin' || type === 'focusout') ev = new win.FocusEvent(type, Object.assign({}, base, { cancelable: false }));
      else if (/^drag|^drop/.test(type) && win.DragEvent) ev = new win.DragEvent(type, base);
      else ev = new win.Event(type, base);
    } catch (_) {
      ev = new win.Event(type, base);
    }
    return el.dispatchEvent(ev);
  }

  const KEY_CODES = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, Backspace: 8, Space: 32, ' ': 32, Home: 36, End: 35 };

  function pressKey(el, key, extra) {
    const code = KEY_CODES[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const init = Object.assign({ key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, keyCode: code, which: code }, extra || {});
    fire(el, 'keydown', init);
    if (key.length === 1 || key === 'Enter') fire(el, 'keypress', Object.assign({}, init, { charCode: key === 'Enter' ? 13 : key.charCodeAt(0) }));
    fire(el, 'keyup', init);
  }

  // ---------------------------------------------------------------------------------------------
  // Submit guard

  let guardDepth = 0;
  const guardListener = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    GAF.util.log('blocked a form submission triggered during autofill');
  };

  /** Runs fn with a capturing listener that cancels any form submission it might trigger. */
  async function withSubmitGuard(fn) {
    const doc = document;
    if (guardDepth++ === 0) doc.addEventListener('submit', guardListener, true);
    try {
      return await fn();
    } finally {
      if (--guardDepth === 0) {
        // keep the guard a moment longer: some frameworks submit asynchronously after a click
        setTimeout(() => { if (guardDepth === 0) doc.removeEventListener('submit', guardListener, true); }, 250);
      }
    }
  }

  const DANGEROUS_BUTTON_TEXT = /\b(submit|send|apply( now| for)?|finish|complete|next|continue|save|review|sign ?in|log ?in|sign ?up|register|create (an )?account|delete|remove|withdraw|cancel|back|previous|upload from|dropbox|google drive|autofill with|linkedin)\b/i;

  function isSubmitLike(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'INPUT' && (type === 'submit' || type === 'image')) return true;
    if (tag === 'BUTTON') {
      if (type === 'submit') return true;
      if (!type && el.form && !el.hasAttribute('aria-haspopup') && el.getAttribute('role') !== 'combobox') return true;
    }
    return false;
  }

  /**
   * Click that simulates the full pointer sequence. Refuses submit buttons and buttons whose text looks like
   * navigation/submission unless opts.allowText matches (used for "Add work experience").
   */
  function safeClick(el, opts) {
    const o = opts || {};
    if (!el) return false;
    const btn = closestComposed(el, 'button, [role="button"], input[type="submit"], input[type="button"], a[href]');
    if (btn && btn !== el && !o.inner) {
      // clicking inside a button: evaluate the button itself
    }
    const target = btn || el;
    const role = target.getAttribute && target.getAttribute('role');
    const isOptionLike = role === 'option' || role === 'combobox' || role === 'menuitem' || role === 'radio' || role === 'checkbox' || role === 'switch' || role === 'tab' ||
      target.hasAttribute('aria-haspopup') || target.hasAttribute('aria-expanded');
    if (isSubmitLike(target) && !isOptionLike) return false;
    if (btn && !isOptionLike) {
      const t = normalize(textOf(btn) || btn.getAttribute('aria-label') || btn.value || '');
      if (!(o.allowText && o.allowText.test(t)) && DANGEROUS_BUTTON_TEXT.test(t)) return false;
    }
    if (target.tagName === 'A' && target.getAttribute('href') && !/^#|^javascript:/i.test(target.getAttribute('href')) && !isOptionLike) return false;

    scrollIntoViewIfNeeded(el);
    let x = 0; let y = 0;
    try { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; } catch (_) { /* ignore */ }
    const m = { clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: 1 };
    fire(el, 'pointerover', m); fire(el, 'pointerenter', Object.assign({}, m, { bubbles: false }));
    fire(el, 'mouseover', m); fire(el, 'mouseenter', Object.assign({}, m, { bubbles: false }));
    fire(el, 'pointerdown', m);
    fire(el, 'mousedown', m);
    try { if (typeof el.focus === 'function' && !o.noFocus) el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    fire(el, 'pointerup', Object.assign({}, m, { buttons: 0 }));
    fire(el, 'mouseup', Object.assign({}, m, { buttons: 0 }));
    if (typeof el.click === 'function') el.click(); else fire(el, 'click', Object.assign({}, m, { buttons: 0 }));
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // Value setting

  function protoFor(el) {
    const win = winOf(el);
    if (el.tagName === 'TEXTAREA') return win.HTMLTextAreaElement.prototype;
    if (el.tagName === 'SELECT') return win.HTMLSelectElement.prototype;
    return win.HTMLInputElement.prototype;
  }

  /** Sets .value via the native setter so React's value tracker sees the change on the next input event. */
  function nativeSetValue(el, value) {
    const desc = Object.getOwnPropertyDescriptor(protoFor(el), 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
  }

  function focusEl(el) {
    try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    if (isTestEnv() || document.activeElement !== el) {
      fire(el, 'focus'); fire(el, 'focusin');
    }
  }

  function blurEl(el) {
    try { el.blur(); } catch (_) { /* ignore */ }
    if (isTestEnv()) { fire(el, 'blur'); fire(el, 'focusout'); }
  }

  function digits(s) { return String(s || '').replace(/\D+/g, ''); }

  function valueLooksSet(el, value) {
    const v = String(el.value == null ? '' : el.value);
    const want = String(value);
    if (v === want) return true;
    if (normalize(v) === normalize(want)) return true;
    const dv = digits(v); const dw = digits(want);
    if (dw.length >= 4 && dv && (dv === dw || dv.endsWith(dw) || dw.endsWith(dv))) return true; // masked phone/date inputs
    return false;
  }

  /**
   * Set a text-like input/textarea/contenteditable.
   * opts.typing: simulate per-character typing (for widgets that only react to key events)
   * opts.blur: fire blur afterwards (default true) - many ATS validate/commit on blur
   */
  async function setText(el, value, opts) {
    const o = Object.assign({ typing: false, blur: true, delay: 0 }, opts || {});
    const str = String(value);
    scrollIntoViewIfNeeded(el);
    focusEl(el);
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      el.textContent = str;
      fire(el, 'input', { data: str });
      if (o.blur) blurEl(el);
      return normalize(el.textContent) === normalize(str);
    }
    if (o.typing) {
      nativeSetValue(el, '');
      fire(el, 'input', { inputType: 'deleteContentBackward' });
      let acc = '';
      for (const ch of str) {
        acc += ch;
        const k = { key: ch, code: /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : '', keyCode: ch.toUpperCase().charCodeAt(0), which: ch.toUpperCase().charCodeAt(0) };
        fire(el, 'keydown', k);
        fire(el, 'keypress', Object.assign({}, k, { charCode: ch.charCodeAt(0) }));
        fire(el, 'beforeinput', { data: ch });
        nativeSetValue(el, acc);
        fire(el, 'input', { data: ch });
        fire(el, 'keyup', k);
        if (o.delay) await sleep(o.delay);
      }
    } else {
      fire(el, 'beforeinput', { data: str });
      nativeSetValue(el, str);
      fire(el, 'input', { data: str });
    }
    fire(el, 'change');
    if (o.blur) blurEl(el);
    return valueLooksSet(el, str);
  }

  /** Native <select>. `pick(optionTexts)` returns the index to choose (or -1). */
  function setSelect(select, index) {
    const opt = select.options[index];
    if (!opt) return false;
    scrollIntoViewIfNeeded(select);
    focusEl(select);
    const desc = Object.getOwnPropertyDescriptor(winOf(select).HTMLSelectElement.prototype, 'selectedIndex');
    if (desc && desc.set) desc.set.call(select, index); else select.selectedIndex = index;
    opt.selected = true;
    fire(select, 'input');
    fire(select, 'change');
    blurEl(select);
    return select.selectedIndex === index;
  }

  function setChecked(input, checked) {
    if (!!input.checked === !!checked) return true;
    const label = input.labels && input.labels[0];
    safeClick(input.getClientRects && input.getClientRects().length || isTestEnv() || !label ? input : label, { noFocus: false });
    if (!!input.checked !== !!checked) {
      // last resort for inputs whose click is intercepted
      const desc = Object.getOwnPropertyDescriptor(winOf(input).HTMLInputElement.prototype, 'checked');
      if (desc && desc.set) desc.set.call(input, !!checked); else input.checked = !!checked;
      fire(input, 'click');
      fire(input, 'input');
      fire(input, 'change');
    }
    return !!input.checked === !!checked;
  }

  /** ARIA checkbox/switch/radio (div/button with role + aria-checked). */
  function setAriaChecked(el, checked) {
    const cur = el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true';
    if (cur === !!checked) return true;
    safeClick(el);
    return (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true') === !!checked;
  }

  // ---------------------------------------------------------------------------------------------
  // Files

  function dataUrlToFile(rec) {
    if (!rec || !rec.dataUrl) return null;
    const comma = rec.dataUrl.indexOf(',');
    const meta = rec.dataUrl.slice(0, comma);
    const b64 = rec.dataUrl.slice(comma + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const type = rec.type || (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    return new File([bytes], rec.name || 'resume.pdf', { type, lastModified: rec.lastModified || Date.now() });
  }

  function makeDataTransfer(file) {
    const win = globalThis;
    const dt = new win.DataTransfer();
    dt.items.add(file);
    return dt;
  }

  async function setFile(input, fileRec) {
    const file = fileRec instanceof File ? fileRec : dataUrlToFile(fileRec);
    if (!file) return false;
    const dt = makeDataTransfer(file);
    try {
      input.files = dt.files;
    } catch (e) {
      GAF.util.log('file assignment failed', e);
      return false;
    }
    fire(input, 'input');
    fire(input, 'change');
    return !!(input.files && input.files.length);
  }

  /** Drag-and-drop a file onto a drop zone (for uploaders without a reachable <input type=file>). */
  async function dropFile(zone, fileRec) {
    const file = fileRec instanceof File ? fileRec : dataUrlToFile(fileRec);
    if (!file) return false;
    const dt = makeDataTransfer(file);
    ['dragenter', 'dragover', 'drop'].forEach((t) => fire(zone, t, { dataTransfer: dt }));
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // Custom dropdowns / comboboxes

  const OPTION_SELECTOR = [
    '[role="option"]', '[role="menuitem"]', '[role="treeitem"]', '[data-automation-id="promptOption"]', '[data-automation-id="menuItem"]',
    '.select__option', '[class*="select__option"]', '.select2-results__option', '.chosen-results li', '.ui-menu-item', '.selectize-dropdown .option',
    '.pac-item', '.autocomplete-suggestion', '.tt-suggestion', 'li[data-value]',
  ].join(',');

  function visibleOptions(scope) {
    return GAF.dom.deepQueryAll(OPTION_SELECTOR, scope || document)
      .filter((o) => isVisible(o) && o.getAttribute('aria-disabled') !== 'true' && !o.classList.contains('select2-results__option--disabled') && !/^\s*$/.test(textOf(o)))
      .filter((o) => !o.querySelector(OPTION_SELECTOR));
  }

  /** Options that belong to the popup opened by `trigger` (aria-controls/aria-owns first, then any visible listbox). */
  function optionsFor(trigger) {
    const ids = [trigger.getAttribute('aria-controls'), trigger.getAttribute('aria-owns')].filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
    for (const id of ids) {
      const pop = GAF.dom.byIdInRoot(trigger, id) || document.getElementById(id);
      if (pop) {
        const opts = visibleOptions(pop);
        if (opts.length) return opts;
      }
    }
    // nearest listbox inside the same widget container
    const container = closestComposed(trigger, '[class*="select" i], [class*="dropdown" i], [class*="combobox" i], [data-automation-id^="formField"]');
    if (container) {
      const opts = visibleOptions(container);
      if (opts.length) return opts;
    }
    // portals: the last visible listbox in the document
    const boxes = GAF.dom.deepQueryAll('[role="listbox"], [role="menu"], [role="tree"], .select__menu, [class*="select__menu"], .select2-results, .chosen-drop, .ui-autocomplete, [data-automation-id="activeListContainer"], .pac-container', document)
      .filter(isVisible);
    for (let i = boxes.length - 1; i >= 0; i--) {
      const opts = visibleOptions(boxes[i]);
      if (opts.length) return opts;
    }
    return [];
  }

  function closePopup(trigger) {
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : trigger;
    pressKey(target, 'Escape');
  }

  /**
   * Generic combobox/dropdown fill.
   *   trigger: the element that opens the list (button, input[role=combobox], div control)
   *   choose(texts) -> index | -1
   *   opts.query: text to type into a search box to filter options (typeahead)
   *   opts.searchInput: explicit input to type into
   *   opts.allowFirstResult: pick the first result when choose() returns -1 but a query was typed (location typeaheads)
   */
  async function setCombobox(trigger, choose, opts) {
    const o = Object.assign({ query: '', searchInput: null, allowFirstResult: false, openTimeout: 1200, searchTimeout: 3500 }, opts || {});
    return withSubmitGuard(async () => {
      scrollIntoViewIfNeeded(trigger);
      const input = o.searchInput || (trigger.tagName === 'INPUT' ? trigger : null);
      let options = [];
      let typed = false;

      const typeQuery = async (inp) => {
        if (!o.query || !inp) return;
        focusEl(inp);
        await setText(inp, o.query, { typing: true, blur: false });
        typed = true;
      };

      if (input && o.query) {
        safeClick(input);
        await typeQuery(input);
        options = (await waitFor(() => optionsFor(input), { timeout: o.searchTimeout })) || [];
      } else {
        safeClick(trigger);
        options = (await waitFor(() => optionsFor(trigger), { timeout: o.openTimeout })) || [];
        if (!options.length) {
          pressKey(trigger, 'ArrowDown');
          options = (await waitFor(() => optionsFor(trigger), { timeout: 600 })) || [];
        }
      }

      let idx = options.length ? choose(options.map((x) => textOf(x))) : -1;

      if (idx < 0 && o.query && !typed) {
        // lists that need a search (long country lists, typeahead) - find a search box inside the popup
        const searchBox = o.searchInput ||
          GAF.dom.deepQuery('input[type="search"], input[role="combobox"], input[role="searchbox"], input[data-automation-id="searchBox"], input[aria-autocomplete]', document);
        const inp = searchBox && isVisible(searchBox) ? searchBox : (trigger.tagName === 'INPUT' ? trigger : null);
        if (inp) {
          await typeQuery(inp);
          options = (await waitFor(() => optionsFor(inp.getAttribute('aria-controls') ? inp : trigger), { timeout: o.searchTimeout })) || [];
          idx = options.length ? choose(options.map((x) => textOf(x))) : -1;
        }
      }

      if (idx < 0 && typed && o.allowFirstResult && options.length) idx = 0;
      if (idx < 0) {
        closePopup(input || trigger);
        return false;
      }
      const chosen = options[idx];
      safeClick(chosen);
      await sleep(120);
      return true;
    });
  }

  GAF.set = {
    fire, pressKey, withSubmitGuard, safeClick, isSubmitLike, nativeSetValue, focusEl, blurEl,
    setText, setSelect, setChecked, setAriaChecked, setFile, dropFile, dataUrlToFile,
    OPTION_SELECTOR, visibleOptions, optionsFor, closePopup, setCombobox, valueLooksSet,
  };
})();
