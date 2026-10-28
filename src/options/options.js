/* Garry AutoFill - options page: renders the profile editor from PROFILE_SCHEMA and autosaves to chrome.storage.local. */
(function () {
  'use strict';
  const S = globalThis.GAF_SHARED;
  const MAX_FILE_BYTES = 8 * 1024 * 1024;

  const SETTINGS_UI = [
    { key: 'autoFillOnAtsSites', label: 'Auto-fill on supported sites', help: 'Fills Workday, Greenhouse, Lever, iCIMS, ADP\u2026 as soon as a form or a new wizard step appears. Nothing is ever submitted.' },
    { key: 'showFloatingButton', label: 'Show the floating Autofill button', help: 'A small button in the corner of application pages.' },
    { key: 'uploadResume', label: 'Attach my resume automatically' },
    { key: 'fillEEO', label: 'Answer voluntary self-identification (EEO) questions', help: 'Uses the answers in the EEO section; blank answers are always skipped.' },
    { key: 'highlightFields', label: 'Highlight fields', help: 'Green = filled, amber dashed = left for you, red = could not fill.' },
    { key: 'overwriteExisting', label: 'Overwrite fields that already have a value', help: 'Off by default so parsed-resume values and your edits are kept.' },
    { key: 'addMissingEntries', label: 'Add work/education entries when the form has fewer than my profile', help: 'Clicks "Add" buttons such as "Add Work Experience" (Workday).' },
    { key: 'debug', label: 'Debug logging', help: 'Logs matching details to the page console.' },
  ];

  let profile = {};
  let settings = {};
  let files = {};
  const $ = (sel, root) => (root || document).querySelector(sel);

  // ------------------------------------------------------------------ saving

  const saveState = $('#saveState');
  let saveTimer = null;
  function scheduleSave() {
    saveState.textContent = 'Saving\u2026';
    saveState.className = 'save-state saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await S.saveProfile(profile);
        saveState.textContent = 'All changes saved';
        saveState.className = 'save-state';
      } catch (e) {
        saveState.textContent = 'Could not save: ' + e.message;
        saveState.className = 'save-state error';
      }
    }, 350);
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ------------------------------------------------------------------ rendering

  function h(tag, attrs, children) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach((c) => c != null && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }

  let uid = 0;
  function control(def, value, onChange) {
    const id = 'f' + (++uid);
    const type = def.type || 'text';
    let input;
    if (type === 'select') {
      input = h('select', { id }, def.options.map((o) => h('option', { value: o, text: o || '\u2014' })));
      if (value && !def.options.includes(value)) input.appendChild(h('option', { value, text: value }));
      input.value = value || '';
      input.addEventListener('change', () => onChange(input.value));
    } else if (type === 'textarea') {
      input = h('textarea', { id, placeholder: def.placeholder || '' });
      input.value = value || '';
      input.addEventListener('input', () => onChange(input.value));
    } else if (type === 'checkbox') {
      input = h('input', { id, type: 'checkbox' });
      input.checked = !!value;
      input.addEventListener('change', () => onChange(input.checked));
      return h('div', { class: 'field check' }, [input, h('label', { for: id, text: def.label })]);
    } else {
      input = h('input', { id, type, placeholder: def.placeholder || '', autocomplete: def.autocomplete || 'off' });
      input.value = value == null ? '' : value;
      input.addEventListener('input', () => onChange(input.value));
    }
    return h('div', { class: 'field' + (type === 'textarea' ? ' wide' : '') }, [
      h('label', { for: id, text: def.label }),
      input,
      def.help ? h('span', { class: 'help', text: def.help }) : null,
    ]);
  }

  function renderSimpleSection(sec) {
    const grid = h('div', { class: 'grid' }, sec.fields.map((def) => control(def, profile[def.key], (v) => { profile[def.key] = v; scheduleSave(); })));
    return h('section', { class: 'card', id: 'sec-' + sec.id }, [
      h('h2', { text: sec.title }),
      sec.note ? h('p', { class: 'note', text: sec.note }) : null,
      grid,
    ]);
  }

  function entryTitle(sec, item, i) {
    if (sec.id === 'experience') return [item.title, item.company].filter(Boolean).join(' \u00b7 ') || `Position ${i + 1}`;
    if (sec.id === 'education') return [item.degree, item.school].filter(Boolean).join(' \u00b7 ') || `School ${i + 1}`;
    return item.match ? `\u201c${item.match}\u201d` : `Rule ${i + 1}`;
  }

  function renderRepeatSection(sec) {
    const list = h('div', {});
    const card = h('section', { class: 'card', id: 'sec-' + sec.id }, [
      h('h2', { text: sec.title }),
      sec.note ? h('p', { class: 'note', text: sec.note }) : null,
      list,
    ]);
    const items = () => (profile[sec.id] = Array.isArray(profile[sec.id]) ? profile[sec.id] : []);

    function draw() {
      list.textContent = '';
      items().forEach((item, i) => {
        const title = h('strong', { text: entryTitle(sec, item, i) });
        const move = (d) => {
          const arr = items();
          const j = i + d;
          if (j < 0 || j >= arr.length) return;
          [arr[i], arr[j]] = [arr[j], arr[i]];
          scheduleSave(); draw();
        };
        const tools = h('div', { class: 'entry-tools' }, [
          h('button', { class: 'btn small ghost', type: 'button', title: 'Move up', 'aria-label': 'Move up', text: '\u2191', onclick: () => move(-1), disabled: i === 0 }),
          h('button', { class: 'btn small ghost', type: 'button', title: 'Move down', 'aria-label': 'Move down', text: '\u2193', onclick: () => move(1), disabled: i === items().length - 1 }),
          h('button', { class: 'btn small danger ghost', type: 'button', text: 'Remove', onclick: () => { items().splice(i, 1); scheduleSave(); draw(); } }),
        ]);
        const grid = h('div', { class: 'grid' }, sec.fields.map((def) => control(def, item[def.key], (v) => {
          item[def.key] = v;
          title.textContent = entryTitle(sec, item, i);
          scheduleSave();
        })));
        list.appendChild(h('div', { class: 'entry' }, [h('div', { class: 'entry-head' }, [title, tools]), grid]));
      });
      if (sec.id === 'experience' && items().length) {
        list.appendChild(h('p', { class: 'note', text: 'Most recent first. The first entry marked \u201ccurrently work here\u201d is used as your current job.' }));
      }
    }

    card.appendChild(h('button', {
      class: 'btn add', type: 'button', text: '+ ' + (sec.addLabel || 'Add'),
      onclick: () => { items().push({}); scheduleSave(); draw(); },
    }));
    draw();
    return card;
  }

  function renderProfile() {
    const host = $('#profileSections');
    host.textContent = '';
    S.PROFILE_SCHEMA.forEach((sec) => host.appendChild(sec.repeat ? renderRepeatSection(sec) : renderSimpleSection(sec)));
    const toc = $('#toc');
    toc.textContent = '';
    const links = [['sec-files', 'Resume']].concat(S.PROFILE_SCHEMA.map((s) => ['sec-' + s.id, s.title.replace(/ \(.*\)$/, '')]), [['sec-settings', 'Behaviour'], ['sec-data', 'Backup']]);
    links.forEach(([id, label]) => toc.appendChild(h('a', { href: '#' + id, text: label })));
  }

  function renderSettings() {
    const host = $('#settings');
    host.textContent = '';
    SETTINGS_UI.forEach((def) => {
      const id = 's-' + def.key;
      const input = h('input', { type: 'checkbox', id });
      input.checked = !!settings[def.key];
      input.addEventListener('change', async () => {
        settings[def.key] = input.checked;
        await S.saveSettings(settings);
        toast('Setting saved');
      });
      host.appendChild(h('label', { class: 'toggle', for: id }, [input, h('span', {}, [def.label, def.help ? h('small', { text: def.help }) : null])]));
    });
  }

  // ------------------------------------------------------------------ files

  function fmtSize(n) {
    if (!n) return '';
    return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  function renderFiles() {
    document.querySelectorAll('.file-slot').forEach((slot) => {
      const key = slot.dataset.slot;
      const rec = files[key];
      const name = $('[data-role="name"]', slot);
      name.textContent = rec ? `${rec.name} (${fmtSize(rec.size)})` : 'No file';
      name.classList.toggle('has', !!rec);
      $('[data-role="remove"]', slot).hidden = !rec;
    });
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function wireFiles() {
    document.querySelectorAll('.file-slot').forEach((slot) => {
      const key = slot.dataset.slot;
      $('[data-role="input"]', slot).addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) { toast('That file is larger than 8 MB.'); return; }
        const dataUrl = await readAsDataUrl(file);
        files[key] = { name: file.name, type: file.type || 'application/octet-stream', size: file.size, lastModified: file.lastModified, dataUrl };
        try {
          await S.saveFiles(files);
          renderFiles();
          toast('Saved ' + file.name);
        } catch (err) {
          toast('Could not save file: ' + err.message);
        }
      });
      $('[data-role="remove"]', slot).addEventListener('click', async () => {
        delete files[key];
        await S.saveFiles(files);
        renderFiles();
      });
    });
  }

  // ------------------------------------------------------------------ backup

  function wireBackup() {
    $('#exportBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ app: 'garry-autofill', version: 1, profile, settings, files }, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'garry-autofill-profile.json' });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
    $('#importInput').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || typeof data !== 'object' || !data.profile) throw new Error('not a Garry AutoFill export');
        profile = Object.assign({}, S.DEFAULT_PROFILE, data.profile);
        settings = Object.assign({}, S.DEFAULT_SETTINGS, data.settings || {});
        files = data.files || {};
        await Promise.all([S.saveProfile(profile), S.saveSettings(settings), S.saveFiles(files)]);
        renderAll();
        toast('Profile imported');
      } catch (err) {
        toast('Import failed: ' + err.message);
      }
    });
    $('#clearBtn').addEventListener('click', async () => {
      if (!confirm('Erase your whole profile, files and settings from this browser?')) return;
      profile = Object.assign({}, S.DEFAULT_PROFILE);
      settings = Object.assign({}, S.DEFAULT_SETTINGS);
      files = {};
      await Promise.all([S.saveProfile(profile), S.saveSettings(settings), S.saveFiles(files)]);
      renderAll();
      toast('Everything erased');
    });
  }

  function renderAll() {
    renderProfile();
    renderSettings();
    renderFiles();
  }

  async function init() {
    const all = await S.loadAll();
    profile = all.profile;
    settings = all.settings;
    files = all.files;
    renderAll();
    wireFiles();
    wireBackup();
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  }

  init();
})();
