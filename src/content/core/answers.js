/*
 * Garry AutoFill - turns a classified key into the concrete answer for a specific field.
 * resolve(key, field, ctx) -> { value, query?, kind? } | null  (null = no data in the profile)
 */
(function () {
  'use strict';
  const GAF = (globalThis.GAF = globalThis.GAF || {});
  if (GAF.answers) return;
  const { normalize } = GAF.util;

  const pad2 = (n) => String(n).padStart(2, '0');
  const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

  function yesNo(v) {
    if (v === true) return 'Yes';
    if (v === false) return 'No';
    const s = normalize(v);
    if (!s) return '';
    if (/^(y|yes|true)$/.test(s)) return 'Yes';
    if (/^(n|no|false)$/.test(s)) return 'No';
    if (/decline|prefer not/.test(s)) return 'Decline to answer';
    return String(v);
  }

  function fullName(p) {
    return [p.firstName, p.lastName].filter((x) => !blank(x)).join(' ');
  }

  const DEGREE_RANK = { highschool: 1, somecollege: 2, associate: 3, bachelor: 4, master: 5, mba: 5, jd: 6, md: 6, phd: 7 };

  function highestDegree(p) {
    let best = null; let rank = 0;
    (p.education || []).forEach((e) => {
      const cat = GAF.options.CATEGORY.degree(e.degree || '');
      const r = DEGREE_RANK[cat] || 0;
      if (r > rank) { rank = r; best = e.degree; }
    });
    return best;
  }

  /** Format a date for a specific input based on type/placeholder/maxlength. parts: {y, m, d} */
  function formatDateFor(field, parts) {
    const el = field.el;
    const type = (field.inputType || '').toLowerCase();
    const y = parts.y; const m = parts.m; const d = parts.d || 1;
    if (!y) return '';
    if (type === 'date') return `${y}-${pad2(m || 1)}-${pad2(d)}`;
    if (type === 'month') return `${y}-${pad2(m || 1)}`;
    const ph = normalize((el && (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder'))) || '') + ' ' + normalize(field.label || '');
    if (/yyyy-mm-dd/.test(ph)) return `${y}-${pad2(m || 1)}-${pad2(d)}`;
    if (/dd[\/.-]mm[\/.-]yyyy/.test(ph)) return `${pad2(d)}/${pad2(m || 1)}/${y}`;
    if (/mm[\/.-]dd[\/.-]yyyy|mm\/dd\/yy/.test(ph)) return `${pad2(m || 1)}/${pad2(d)}/${y}`;
    if (/mm[\/.-]yyyy|mm\/yy/.test(ph)) return `${pad2(m || 1)}/${y}`;
    if (/^\s*yyyy\s*$|\byear\b/.test(ph) && !/month/.test(ph)) return String(y);
    if (!m) return String(y);
    if (parts.monthYearOnly) return `${pad2(m)}/${y}`;
    return `${pad2(m)}/${pad2(d)}/${y}`;
  }

  function parseIsoDate(s) {
    const t = String(s || '').trim();
    let mm = t.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
    if (mm) return { y: +mm[1], m: +mm[2], d: mm[3] ? +mm[3] : 1 };
    mm = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mm) return { y: +mm[3], m: +mm[1], d: +mm[2] };
    mm = t.match(/^(\d{1,2})\/(\d{4})$/);
    if (mm) return { y: +mm[2], m: +mm[1], d: 1 };
    return null;
  }

  function monthValue(field, month) {
    if (!month) return '';
    const m = parseInt(month, 10);
    if (isNaN(m)) return String(month);
    if (field.kind === 'text') {
      const ph = normalize((field.el && field.el.getAttribute('placeholder')) || '');
      if (/^m$/.test(ph)) return String(m);
      return pad2(m);
    }
    return String(m); // option matcher understands numbers and month names
  }

  function phoneFor(field, p) {
    const phone = String(p.phone || '').trim();
    if (!phone) return '';
    const code = String(p.phoneCountryCode || '').trim();
    const hint = normalize((field.label || '') + ' ' + ((field.el && field.el.getAttribute('placeholder')) || ''));
    if (/^\+/.test(phone)) return phone;
    if (code && (/country code|include (the )?(country|\+)|international|e\.?164|^\+|\+\d/.test(hint))) return `${code} ${phone}`;
    return phone;
  }

  function stateFor(field, p) {
    const s = String(p.state || '').trim();
    if (!s) return '';
    const el = field.el;
    const maxLen = el && el.maxLength > 0 ? el.maxLength : 0;
    const variants = GAF.options.stateVariants(s);
    if (field.kind === 'text' && (maxLen === 2 || /\babbreviation\b|\b2.letter\b/.test(normalize(field.label)))) return variants[1] || s;
    return variants[0] || s;
  }

  function locationString(p, opts) {
    const o = opts || {};
    const state = p.state ? (o.stateCode ? (GAF.options.stateVariants(p.state)[1] || p.state) : GAF.options.stateVariants(p.state)[0]) : '';
    const parts = [p.city, state];
    if (o.country && p.country) parts.push(p.country);
    return parts.filter((x) => !blank(x)).join(', ');
  }

  function entry(list, idx) {
    return (Array.isArray(list) && list[idx]) || null;
  }

  /**
   * @returns {{value:any, query?:string, multi?:boolean}|null}
   */
  function resolve(key, field, ctx) {
    const p = ctx.profile || {};
    const idx = field.index || 0;
    const r = (value, extra) => (blank(value) ? null : Object.assign({ value }, extra || {}));

    if (key === 'custom') return r(field.classification && field.classification.custom ? field.classification.custom.answer : null);

    const [group, sub] = key.includes('.') ? key.split('.') : [null, key];

    if (group === 'exp') {
      const e = entry(p.experience, idx);
      if (!e) return null;
      switch (sub) {
        case 'title': return r(e.title, { query: e.title });
        case 'company': return r(e.company, { query: e.company });
        case 'location': return r(e.location, { query: String(e.location || '').split(',')[0] });
        case 'description': return r(e.description);
        case 'current': return r(e.current ? 'Yes' : (field.kind === 'checkbox' ? null : 'No'));
        case 'startMonth': return r(monthValue(field, e.startMonth));
        case 'startYear': return r(e.startYear ? String(e.startYear) : '');
        case 'endMonth': return e.current ? null : r(monthValue(field, e.endMonth));
        case 'endYear': return e.current ? null : r(e.endYear ? String(e.endYear) : '');
        case 'startDate': return r(e.startYear ? formatDateFor(field, { y: e.startYear, m: +e.startMonth || 1, monthYearOnly: true }) : '');
        case 'endDate': return e.current || !e.endYear ? null : r(formatDateFor(field, { y: e.endYear, m: +e.endMonth || 1, monthYearOnly: true }));
        default: return null;
      }
    }

    if (group === 'edu') {
      const e = entry(p.education, idx);
      if (!e) return null;
      switch (sub) {
        case 'school': return r(e.school, { query: e.school });
        case 'degree': return r(e.degree, { query: e.degree });
        case 'field': return r(e.fieldOfStudy, { query: e.fieldOfStudy });
        case 'gpa': return r(e.gpa);
        case 'startMonth': return r(monthValue(field, e.startMonth));
        case 'startYear': return r(e.startYear ? String(e.startYear) : '');
        case 'endMonth': return r(monthValue(field, e.endMonth));
        case 'endYear':
        case 'graduationYear': return r(e.endYear ? String(e.endYear) : '');
        case 'startDate': return r(e.startYear ? formatDateFor(field, { y: e.startYear, m: +e.startMonth || 9, monthYearOnly: true }) : '');
        case 'endDate': return r(e.endYear ? formatDateFor(field, { y: e.endYear, m: +e.endMonth || 5, monthYearOnly: true }) : '');
        default: return null;
      }
    }

    switch (key) {
      case 'firstName': return r(p.firstName);
      case 'middleName': return r(p.middleName);
      case 'lastName': return r(p.lastName);
      case 'preferredName': return r(p.preferredName || p.firstName);
      case 'fullName': return r(fullName(p));
      case 'pronouns': return r(p.pronouns);
      case 'email':
      case 'confirmEmail': return r(p.email);
      case 'phone': return r(phoneFor(field, p));
      case 'phoneCountryCode': return r(p.phoneCountryCode, { query: p.country || 'United States' });
      case 'phoneExtension': return null;
      case 'phoneType': return r(p.phoneType);
      case 'addressLine1': return r(p.addressLine1);
      case 'addressLine2': return r(p.addressLine2);
      case 'city': return r(p.city, { query: p.city });
      case 'county': return r(p.county);
      case 'state': return r(stateFor(field, p), { query: GAF.options.stateVariants(p.state || '')[0] });
      case 'postalCode': return r(p.postalCode);
      case 'country': return r(p.country, { query: p.country });
      case 'location': return r(locationString(p), { query: p.city ? `${p.city}` : '' });
      case 'linkedin': return r(p.linkedin);
      case 'github': return r(p.github);
      case 'twitter': return r(p.twitter);
      case 'portfolio': return r(p.portfolio || p.github || '');
      case 'otherUrl': return r(p.otherUrl);
      case 'resume': return ctx.files && ctx.files.resume ? { value: ctx.files.resume, file: true } : null;
      case 'coverLetterFile': return ctx.files && ctx.files.coverLetter ? { value: ctx.files.coverLetter, file: true } : null;
      case 'currentCompany': {
        const cur = (p.experience || []).find((e) => e.current) || (p.experience || [])[0];
        return r(p.currentCompany || (cur && cur.company), { query: p.currentCompany || (cur && cur.company) });
      }
      case 'currentTitle': {
        const cur = (p.experience || []).find((e) => e.current) || (p.experience || [])[0];
        return r(p.currentTitle || (cur && cur.title));
      }
      case 'yearsExperience': return r(p.yearsExperience);
      case 'desiredSalary': return r(p.desiredSalary);
      case 'salaryCurrency': return r(p.salaryCurrency);
      case 'noticePeriod': return r(p.noticePeriod);
      case 'availableStartDate': {
        const d = parseIsoDate(p.availableStartDate);
        if (!d) return r(p.availableStartDate);
        if (field.kind === 'select' || field.kind === 'radio' || field.kind === 'combobox') return null; // option lists like "Immediately / 2 weeks" - leave to the user
        return r(formatDateFor(field, d));
      }
      case 'workPreference': return r(p.workPreference);
      case 'authorizedToWork': return r(yesNo(p.authorizedToWork));
      case 'requireSponsorship': return r(yesNo(p.requireSponsorship));
      case 'authorizedNoSponsorship': {
        const a = yesNo(p.authorizedToWork); const s = yesNo(p.requireSponsorship);
        if (!a || !s) return null;
        return r(a === 'Yes' && s === 'No' ? 'Yes' : 'No');
      }
      case 'isCitizen': {
        if (blank(p.citizenship)) return null;
        const ck = GAF.options.countryKey(p.citizenship);
        return r(ck === 'united states' ? 'Yes' : 'No');
      }
      case 'citizenship': return r(p.citizenship, { query: p.citizenship });
      case 'over18': return r(yesNo(p.over18));
      case 'willingToRelocate': return r(yesNo(p.willingToRelocate));
      case 'willingToTravel': return r(yesNo(p.willingToTravel));
      case 'previouslyEmployed': return r(yesNo(p.previouslyEmployed));
      case 'relativesAtCompany': return r(yesNo(p.relativesAtCompany));
      case 'hasReferral': return r(p.referrerName ? 'Yes' : (blank(p.howDidYouHear) ? '' : 'No'));
      case 'referrerName': return r(p.referrerName);
      case 'howDidYouHear': return r(p.howDidYouHear, { query: p.howDidYouHear });
      case 'driversLicense': return r(yesNo(p.driversLicense));
      case 'backgroundCheck': return r(yesNo(p.backgroundCheck));
      case 'securityClearance': return r(p.securityClearance);
      case 'nonCompete': return r(yesNo(p.nonCompete));
      case 'smsConsent': return r(yesNo(p.smsConsent));
      case 'gender': return ctx.settings && ctx.settings.fillEEO === false ? null : r(p.gender);
      case 'transgender': return ctx.settings && ctx.settings.fillEEO === false ? null : r(yesNo(p.transgender));
      case 'sexualOrientation': return ctx.settings && ctx.settings.fillEEO === false ? null : r(p.sexualOrientation);
      case 'hispanicLatino': return ctx.settings && ctx.settings.fillEEO === false ? null : r(yesNo(p.hispanicLatino));
      case 'race': return ctx.settings && ctx.settings.fillEEO === false ? null : r(p.race);
      case 'veteran': return ctx.settings && ctx.settings.fillEEO === false ? null : r(p.veteran);
      case 'disability': return ctx.settings && ctx.settings.fillEEO === false ? null : r(p.disability);
      case 'highestEducation': return r(highestDegree(p));
      case 'languages': return r(p.languages);
      case 'skills': return r(p.skills);
      default: return null;
    }
  }

  GAF.answers = { resolve, yesNo, formatDateFor, parseIsoDate, locationString, fullName, highestDegree, phoneFor, stateFor };
})();
