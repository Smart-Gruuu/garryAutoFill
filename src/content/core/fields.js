/*
 * Garry AutoFill - collects fillable fields from the page into descriptors.
 *
 * Field descriptor:
 * {
 *   kind: 'text'|'textarea'|'date'|'select'|'radio'|'checkbox'|'checkboxGroup'|'file'|'combobox'|'ariaRadio'|'ariaCheckbox'|'custom'
 *   el:       primary element (input/select/textarea/trigger button; first member for groups)
 *   members:  group elements (radio/checkbox inputs, or [role=radio] elements)
 *   label:    the control's own label       question: group/question text (groups)
 *   options:  option texts (select / radio / checkboxGroup / ariaRadio); null for comboboxes
 *   attrs:    humanized name/id/automation-id text
 *   section:  nearest preceding headings (nearest first)
 *   order:    composed-tree index
 *   inputType, autocomplete, required
 *   adapter-specific extra props are allowed (e.g. field.widget = 'workday-dropdown')
 * }
 */
(function () {
  'use strict';
  const GAF = (globalThis.GAF = globalThis.GAF || {});
  if (GAF.fields) return;
  const D = GAF.dom;
  const { normalize } = GAF.util;

  const CANDIDATES = [
    'input', 'select', 'textarea', '[role="combobox"]', 'button[aria-haspopup="listbox"]', '[role="radiogroup"]',
    '[role="checkbox"]', '[role="switch"]', '[contenteditable="true"]',
  ].join(',');

  const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'search', 'range', 'color']);

  /**
   * Sign-in / sign-up forms are left alone. A password box inside a large profile form (iCIMS puts
   * "Login / Password / Re-enter" at the top of the candidate profile) does not make the whole form off-limits:
   * only small forms (a few fields besides the passwords) count as authentication forms.
   */
  function isAuthContext(el) {
    const form = el.form || D.closestComposed(el, 'form');
    const scope = form || D.closestComposed(el, 'section, [role="dialog"], main') || null;
    if (!scope) return false;
    const pws = Array.from(scope.querySelectorAll('input[type="password"]')).filter(D.isVisible);
    if (!pws.length) return false;
    const others = Array.from(scope.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), select, textarea'))
      .filter((x) => D.isInteractable(x));
    return others.length <= 4;
  }

  function isSearchContext(el) {
    // typeahead pickers inside form fields (Workday prompts) are not page search boxes
    if (el.matches && el.matches('[data-uxi-widget-type="selectinput"], [role="combobox"]')) return false;
    if (D.closestComposed(el, '[role="search"], form[action*="search" i], [class*="search-bar" i], [class*="searchbar" i], [data-automation-id*="search" i]:not([data-automation-id="searchBox"])')) return true;
    const t = normalize((el.getAttribute('name') || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || ''));
    return /^(q|query|keywords?|search)$|search (jobs|for|by|keyword|location)|job search|keyword/.test(t);
  }

  function inputKind(el) {
    const tag = el.tagName;
    const role = el.getAttribute('role');
    if (el.getAttribute('contenteditable') === 'true') return 'text';
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'BUTTON') return el.getAttribute('aria-haspopup') === 'listbox' ? 'combobox' : null;
    if (role === 'radiogroup') return 'ariaRadio';
    if (tag !== 'INPUT' && (role === 'checkbox' || role === 'switch')) return 'ariaCheckbox';
    if (tag !== 'INPUT' && role === 'combobox') {
      // div-based combobox (e.g. react-select container) - only if it has no inner input
      return el.querySelector('input') ? null : 'combobox';
    }
    if (tag !== 'INPUT') return null;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (SKIP_INPUT_TYPES.has(type)) return null;
    if (type === 'password') return 'password';
    if (type === 'radio') return 'radio';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'file') return 'file';
    if (type === 'date' || type === 'month') return 'date';
    if (role === 'combobox' || el.getAttribute('aria-autocomplete') === 'list' || el.getAttribute('aria-autocomplete') === 'both' || el.getAttribute('aria-haspopup') === 'listbox') return 'combobox';
    return 'text';
  }

  function isDisabled(el) {
    if (el.disabled) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    const fs = D.closestComposed(el, 'fieldset[disabled]');
    return !!fs;
  }

  function groupKey(el) {
    const scope = el.form || el.getRootNode();
    const name = el.getAttribute('name');
    return { scope, name };
  }

  function memberLabel(el) {
    // For radios/checkboxes the option text is the element's own label
    let t = D.ownLabel(el);
    if (!t) {
      // unlabeled option: use the wrapper text when the wrapper holds only this control
      const p = D.parentComposed(el);
      if (p && D.countControls(p) <= 1) t = GAF.util.cleanLabel(D.textOf(p));
      if (!t && el.nextSibling && el.nextSibling.nodeType === 3) t = GAF.util.cleanLabel(el.nextSibling.nodeValue);
    }
    if (!t) t = el.value && el.value !== 'on' ? el.value : '';
    return t;
  }

  /** Text around an element (largest ancestor text up to ~600 chars) - used for unlabeled upload widgets. */
  function surroundingText(el) {
    let best = '';
    let n = el;
    for (let i = 0; i < 8; i++) {
      n = D.parentComposed(n);
      if (!n || n.nodeType !== 1 || /^(FORM|BODY|HTML)$/.test(n.tagName)) break;
      const t = D.textOf(n);
      if (t.length > 600) break;
      if (t) best = t;
    }
    return best;
  }

  /**
   * Collects field descriptors in the document (and open/closed shadow roots).
   * @param {object} ctx engine context (adapter may exclude elements)
   */
  function collect(ctx) {
    const root = (ctx && ctx.root) || document;
    const adapter = ctx && ctx.adapter;
    const order = D.orderIndex(root);
    const headings = D.collectHeadings(root, order);
    const raw = D.deepQueryAll(CANDIDATES, root);
    const fields = [];
    const radioGroups = new Map();
    const checkboxByName = new Map();
    const seen = new Set();

    for (const el of raw) {
      if (seen.has(el)) continue;
      if (el.closest && el.closest('[' + D.UI_ATTR + ']')) continue;
      const kind = inputKind(el);
      if (!kind) continue;
      if (adapter && typeof adapter.exclude === 'function' && adapter.exclude(el, ctx)) continue;
      if (kind === 'password') continue;
      if (isDisabled(el)) continue;
      if ((kind === 'text' || kind === 'textarea' || kind === 'date') && el.readOnly) continue;
      if (D.closestComposed(el, '[role="listbox"], [role="menu"], [role="option"]') && kind !== 'ariaRadio') continue; // options inside popups
      if (!D.isInteractable(el)) continue;
      if (isSearchContext(el)) continue;
      if (isAuthContext(el)) continue;

      if (kind === 'radio') {
        const { scope, name } = groupKey(el);
        const k = name ? scope : el.parentElement;
        const mapKey = (name || '') + '::';
        if (!radioGroups.has(k)) radioGroups.set(k, new Map());
        const byName = radioGroups.get(k);
        const gk = name ? mapKey : 'anon::' + fields.length;
        if (!byName.has(gk)) {
          const f = { kind: 'radio', el, members: [el] };
          byName.set(gk, f);
          fields.push(f);
        } else byName.get(gk).members.push(el);
        seen.add(el);
        continue;
      }

      if (kind === 'checkbox') {
        const name = el.getAttribute('name');
        const scope = el.form || el.getRootNode();
        if (name) {
          if (!checkboxByName.has(scope)) checkboxByName.set(scope, new Map());
          const m = checkboxByName.get(scope);
          if (m.has(name)) { m.get(name).members.push(el); seen.add(el); continue; }
          const f = { kind: 'checkbox', el, members: [el] };
          m.set(name, f);
          fields.push(f);
        } else fields.push({ kind: 'checkbox', el, members: [el] });
        seen.add(el);
        continue;
      }

      if (kind === 'ariaRadio') {
        const members = Array.from(el.querySelectorAll('[role="radio"]'));
        if (!members.length) continue;
        members.forEach((m) => seen.add(m));
        fields.push({ kind: 'ariaRadio', el, members });
        continue;
      }

      fields.push({ kind, el, members: [el] });
      seen.add(el);
    }

    // finalize descriptors
    for (const f of fields) {
      if (f.kind === 'checkbox' && f.members.length > 1) f.kind = 'checkboxGroup';
      const el = f.el;
      f.order = order.get(el) != null ? order.get(el) : 0;
      f.section = D.sectionFor(f.order, headings);
      f.attrs = D.attrText(el);
      f.inputType = (el.getAttribute('type') || '').toLowerCase();
      f.autocomplete = normalize(el.getAttribute('autocomplete') || '').replace(/^(section-\S+|shipping|billing)\s+/, '');
      f.required = !!(el.required || el.getAttribute('aria-required') === 'true');
      if (f.kind === 'radio' || f.kind === 'checkboxGroup' || f.kind === 'ariaRadio') {
        f.options = f.members.map((m) => (f.kind === 'ariaRadio' ? GAF.util.cleanLabel(D.ownLabel(m) || D.textOf(m)) : memberLabel(m)));
        f.question = f.kind === 'ariaRadio' ? (D.ownLabel(el) || D.containerText(el)) : D.groupQuestion(f.members);
        f.label = f.question;
      } else if (f.kind === 'checkbox') {
        f.label = memberLabel(el);
        // a lone checkbox may sit under a question ("Are you 18+?" [ ] Yes)
        // (no sibling fallback: the previous sibling of a lone checkbox is usually another field's label)
        const q = D.containerText(el, [el].concat(el.labels ? Array.from(el.labels) : []), { noSibling: true });
        f.question = q && normalize(q) !== normalize(f.label) ? q : '';
      } else {
        f.label = D.labelFor(el);
        f.question = '';
        if (f.kind === 'select') f.options = Array.from(el.options).map((o) => GAF.util.cleanLabel(o.textContent || o.label || ''));
      }
      if (f.kind === 'file') f.context = surroundingText(el);
    }

    fields.sort((a, b) => a.order - b.order);
    return fields;
  }

  /** Whether a field currently has no value (so we may fill it). */
  function isEmpty(f) {
    const el = f.el;
    switch (f.kind) {
      case 'text': case 'textarea': case 'date':
        if (el.getAttribute('contenteditable') === 'true') return !normalize(el.textContent);
        return !String(el.value || '').trim();
      case 'select': {
        if (el.selectedIndex < 0) return true;
        const opt = el.options[el.selectedIndex];
        // an empty-valued first option is a placeholder ("-- Make a Selection --", "Please choose")
        return !opt || (!opt.value && el.selectedIndex === 0) || GAF.options.isPlaceholder(opt.textContent);
      }
      case 'radio': return !f.members.some((m) => m.checked);
      case 'checkbox': return !el.checked;
      case 'checkboxGroup': return !f.members.some((m) => m.checked);
      case 'ariaRadio': return !f.members.some((m) => m.getAttribute('aria-checked') === 'true');
      case 'ariaCheckbox': return el.getAttribute('aria-checked') !== 'true';
      case 'file': return !(el.files && el.files.length);
      case 'combobox': {
        if (el.tagName === 'INPUT') {
          if (String(el.value || '').trim()) return false;
          // react-select & co. show the chosen value next to the input
          const ctl = D.closestComposed(el, '[class*="control" i], [class*="select" i], [class*="combobox" i]');
          const single = ctl && ctl.querySelector('[class*="single-value" i], [class*="singleValue" i], [class*="multi-value" i], [class*="multiValue" i], [class*="selected" i]:not(input)');
          return !(single && normalize(D.textOf(single)));
        }
        const t = normalize(D.textOf(el) || el.getAttribute('aria-valuetext') || el.getAttribute('value') || '');
        return !t || GAF.options.isPlaceholder(t);
      }
      default: return true;
    }
  }

  GAF.fields = { collect, isEmpty, inputKind, isAuthContext, isSearchContext, CANDIDATES };
})();
