/*
 * Garry AutoFill - choosing the right option (select / radio / dropdown / typeahead) for a profile answer.
 * GAF.options.pick(optionTexts, answer, key) -> index or -1
 */
(function () {
  'use strict';
  const GAF = (globalThis.GAF = globalThis.GAF || {});
  if (GAF.options) return;
  const { simplify } = GAF.util;

  // ------------------------------------------------------------------------------------------
  // Reference data

  const US_STATES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
    DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
    KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
    NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
    PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
    VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
    GU: 'Guam', VI: 'Virgin Islands', AS: 'American Samoa', MP: 'Northern Mariana Islands',
    AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia',
    NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon',
  };

  const COUNTRY_ALIASES = [
    ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a', 'america'],
    ['united kingdom', 'uk', 'u k', 'great britain', 'england', 'britain', 'united kingdom of great britain and northern ireland'],
    ['canada', 'ca'],
    ['india', 'in'],
    ['germany', 'deutschland', 'de'],
    ['netherlands', 'the netherlands', 'holland', 'nl'],
    ['south korea', 'korea republic of', 'republic of korea', 'korea, republic of', 'kr'],
    ['china', 'peoples republic of china', 'prc', 'cn'],
    ['taiwan', 'taiwan province of china', 'republic of china'],
    ['russia', 'russian federation'],
    ['vietnam', 'viet nam'],
    ['iran', 'iran islamic republic of'],
    ['czech republic', 'czechia'],
    ['ireland', 'republic of ireland'],
    ['mexico', 'mx'],
    ['brazil', 'brasil', 'br'],
    ['australia', 'au'],
    ['united arab emirates', 'uae'],
    ['philippines', 'the philippines'],
    ['turkey', 'turkiye'],
    ['ukraine', 'ua'],
    ['spain', 'espana', 'es'],
  ];

  const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

  const DECLINE_RE = /\b(decline|declined|prefer not|rather not|not wish|don't wish|dont wish|do not wish|wish not|choose not|chose not|not to (answer|disclose|say|specify|provide|identify|self ?identify)|don't want to|dont want to|do not want to|no answer|not disclosed|undisclosed|not specified|not declared|i don't know|do not know|prefer to not|not applicable - prefer)\b/;

  function classifyYesNo(text) {
    const t = GAF.util.normalize(text);
    if (DECLINE_RE.test(t)) return 'decline';
    if (/^(yes|y|true|oui|si|s\u00ed)\b/.test(t)) return 'yes';
    if (/^(no|n|false|non)\b/.test(t)) return 'no';
    if (/\b(i am not|i'm not|i do not|i don't|i have not|i haven't|i will not|i won't|not (currently|a|an|eligible|authorized|required|willing|able))\b/.test(t)) return 'no';
    if (/\b(i am|i'm|i do|i have|i will|i can|i would|authorized|eligible|willing|agree)\b/.test(t)) return 'yes';
    return null;
  }

  // ------------------------------------------------------------------------------------------
  // Canonical category matchers for specific keys. Each returns a category id for a text (option or answer).

  const CATEGORY = {
    yesno: classifyYesNo,
    gender(text) {
      const t = GAF.util.normalize(text);
      if (DECLINE_RE.test(t)) return 'decline';
      if (/non.?binary|genderqueer|gender ?non|nonconforming|non-conforming|genderfluid|agender|two.?spirit/.test(t)) return 'nonbinary';
      if (/\b(female|woman|women|f)\b/.test(t)) return 'female';
      if (/\b(male|man|men|m)\b/.test(t)) return 'male';
      if (/self.?describe|not listed|another|other/.test(t)) return 'other';
      return null;
    },
    race(text) {
      const t = GAF.util.normalize(text);
      if (DECLINE_RE.test(t)) return 'decline';
      if (/two or more|multi.?racial|mixed|more than one/.test(t)) return 'two';
      if (/hawaiian|pacific islander/.test(t)) return 'pacific';
      if (/american indian|alaska(n)? native|native american|indigenous|first nations/.test(t)) return 'native';
      if (/black|african/.test(t)) return 'black';
      if (/hispanic|latin[oax]/.test(t)) return 'hispanic';
      if (/\basian\b/.test(t)) return 'asian';
      if (/\bwhite\b|caucasian/.test(t)) return 'white';
      if (/middle eastern|north african|mena/.test(t)) return 'mena';
      return null;
    },
    veteran(text) {
      const t = GAF.util.normalize(text);
      if (DECLINE_RE.test(t)) return 'decline';
      if (/\b(not a|am not|i'm not|no[t]? .*veteran|non-?veteran|not protected)\b/.test(t) || /^no\b/.test(t)) return 'no';
      if (/identify as one or more|protected veteran|i am a veteran|\bveteran\b|^yes\b/.test(t)) return 'yes';
      return null;
    },
    disability(text) {
      const t = GAF.util.normalize(text);
      if (DECLINE_RE.test(t)) return 'decline';
      if (/^no\b|do not have a disability|don't have a disability|not have a disability|no disability/.test(t)) return 'no';
      if (/^yes\b|have a disability|i have|had one/.test(t)) return 'yes';
      return null;
    },
    degree(text) {
      const t = GAF.util.simplify(text);
      if (/\bmba\b|master of business/.test(t)) return 'mba';
      if (/\bph ?d\b|doctor of philosophy|doctorate|doctoral/.test(t)) return 'phd';
      if (/\bj ?d\b|juris doctor/.test(t)) return 'jd';
      if (/\bm ?d\b|doctor of medicine/.test(t)) return 'md';
      if (/master|\bm ?s\b|\bm ?a\b|\bmsc\b|\bm eng\b|\bmeng\b|\bmfa\b|\bmph\b|graduate degree/.test(t)) return 'master';
      if (/bachelor|\bb ?s\b|\bb ?a\b|\bbsc\b|\bb eng\b|\bbeng\b|\bbfa\b|\bbba\b|undergraduate|4 year degree|four year degree/.test(t)) return 'bachelor';
      if (/associate|\ba ?a\b|\ba ?s\b|2 year degree|two year degree/.test(t)) return 'associate';
      if (/high school|\bged\b|secondary|diploma/.test(t)) return 'highschool';
      if (/some college|no degree/.test(t)) return 'somecollege';
      return null;
    },
    phoneType(text) {
      const t = GAF.util.normalize(text);
      if (/mobile|cell/.test(t)) return 'mobile';
      if (/home|landline|residence/.test(t)) return 'home';
      if (/work|business|office/.test(t)) return 'work';
      return null;
    },
    workPreference(text) {
      const t = GAF.util.normalize(text);
      if (/hybrid/.test(t)) return 'hybrid';
      if (/remote|virtual|work from home|wfh/.test(t)) return 'remote';
      if (/on.?site|in.?office|in person|office/.test(t)) return 'onsite';
      if (/flexible|any|open to all|no preference/.test(t)) return 'flexible';
      return null;
    },
    pronouns(text) {
      const t = GAF.util.normalize(text);
      if (DECLINE_RE.test(t)) return 'decline';
      if (/they/.test(t)) return 'they';
      if (/\bshe\b|\bher\b/.test(t)) return 'she';
      if (/\bhe\b|\bhim\b/.test(t)) return 'he';
      return null;
    },
  };

  const KEY_CATEGORY = {
    gender: 'gender', race: 'race', veteran: 'veteran', disability: 'disability', degree: 'degree', 'edu.degree': 'degree',
    highestEducation: 'degree', phoneType: 'phoneType', workPreference: 'workPreference', pronouns: 'pronouns',
    hispanicLatino: 'yesno', transgender: 'yesno', authorizedToWork: 'yesno', requireSponsorship: 'yesno', over18: 'yesno',
    willingToRelocate: 'yesno', willingToTravel: 'yesno', previouslyEmployed: 'yesno', relativesAtCompany: 'yesno',
    driversLicense: 'yesno', backgroundCheck: 'yesno', nonCompete: 'yesno', smsConsent: 'yesno', 'exp.current': 'yesno',
    hasReferral: 'yesno',
  };

  // ------------------------------------------------------------------------------------------
  // Scoring

  function tokens(s) { return simplify(s).split(' ').filter(Boolean); }

  function similarity(a, b) {
    const sa = simplify(a); const sb = simplify(b);
    if (!sa || !sb) return 0;
    if (sa === sb) return 1;
    const ta = new Set(tokens(sa)); const tb = new Set(tokens(sb));
    let inter = 0;
    ta.forEach((t) => { if (tb.has(t)) inter++; });
    const jac = inter / (ta.size + tb.size - inter || 1);
    let contain = 0;
    const re = (x) => new RegExp('(^| )' + GAF.util.escapeRegex(x) + '( |$)');
    if (sb.length >= 2 && re(sb).test(sa)) contain = 0.75 + 0.2 * (sb.length / sa.length);
    else if (sa.length >= 2 && re(sa).test(sb)) contain = 0.7 + 0.2 * (sa.length / sb.length);
    return Math.max(jac * 0.9, contain);
  }

  /** "BS" vs "Bachelor of Science", "MBA" vs "Master of Business Administration" */
  function acronymMatch(a, b) {
    const acr = (s) => tokens(s).filter((t) => !/^(of|in|the|and|for|degree)$/.test(t)).map((t) => t[0]).join('');
    const flat = (s) => simplify(s).replace(/ /g, '');
    const fa = flat(a); const fb = flat(b);
    return (fa.length >= 2 && fa.length <= 5 && fa === acr(b)) || (fb.length >= 2 && fb.length <= 5 && fb === acr(a));
  }

  function countryKey(s) {
    const t = simplify(s).replace(/\(.*?\)/g, '').replace(/\+\d+/g, '').trim();
    for (const group of COUNTRY_ALIASES) if (group.includes(t)) return group[0];
    return t;
  }

  function stateVariants(s) {
    const t = String(s || '').trim();
    const up = t.toUpperCase();
    if (US_STATES[up]) return [US_STATES[up], up];
    const hit = Object.entries(US_STATES).find(([, name]) => simplify(name) === simplify(t));
    return hit ? [hit[1], hit[0]] : [t];
  }

  function parseNumber(s) {
    const m = String(s || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  /** Parses "3-5 years", "10+", "Less than 1", "More than 10", "$100,000 - $120,000" into [min,max]. */
  function parseRange(text) {
    const t = GAF.util.normalize(text).replace(/,/g, '').replace(/(\d+(\.\d+)?)\s*k\b/g, (m, n) => String(parseFloat(n) * 1000));
    const nums = (t.match(/\d+(\.\d+)?/g) || []).map(parseFloat);
    if (!nums.length) {
      if (/\b(none|no experience|zero)\b/.test(t)) return [0, 0.99];
      return null;
    }
    if (/less than|under|fewer than|below|up to|<|^0\s*-/.test(t) && nums.length === 1) return [0, nums[0] - (/up to/.test(t) ? -0.001 : 0.001)];
    if (/\+|or more|more than|over|above|at least|greater|>/.test(t) && nums.length === 1) return [nums[0] + (/more than|over|above|greater|>/.test(t) ? 0.001 : 0), Infinity];
    if (nums.length >= 2) return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
    return [nums[0], nums[0]];
  }

  function pickNumeric(options, answer) {
    const n = parseNumber(answer);
    if (isNaN(n)) return -1;
    let best = -1; let bestWidth = Infinity;
    options.forEach((o, i) => {
      const r = parseRange(o);
      if (!r) return;
      if (n >= r[0] && n <= r[1] + 0.999) {
        const w = r[1] - r[0];
        if (best === -1 || w < bestWidth) { best = i; bestWidth = w; }
      }
    });
    return best;
  }

  const PLACEHOLDER_RE = /^(select|choose|please select|please choose|--|- select|select one|select an option|pick one|none selected|\s*)$/;

  function isPlaceholder(text) {
    const t = GAF.util.normalize(text).replace(/[.\u2026:-]+$/g, '').replace(/^[-\s]+|[-\s]+$/g, '');
    return !t || PLACEHOLDER_RE.test(t) || /^(select|choose)\b.{0,30}$/.test(t) ||
      (t.length <= 40 && /^(please )?(make a selection|select an? (option|value|item|one)|choose (an? )?(option|one|value)|no selection|not selected|none selected|pick (one|an option))$/.test(t));
  }

  function monthIndex(v) {
    const s = simplify(v);
    const n = parseInt(s, 10);
    if (!isNaN(n) && n >= 1 && n <= 12) return n - 1;
    const i = MONTH_NAMES.findIndex((m) => m === s || m.slice(0, 3) === s.slice(0, 3));
    return i;
  }

  /**
   * Chooses the best option for an answer.
   * @param {string[]} options option labels (placeholders are ignored)
   * @param {string|number|boolean} answer profile answer
   * @param {string} [key] profile key - enables category-aware matching (EEO, yes/no, degree, country...)
   * @param {object} [ctx] extra hints, e.g. { country } for phone country codes
   * @returns {number} index into options, or -1
   */
  function pick(options, answer, key, ctx) {
    if (answer == null || answer === '') return -1;
    if (typeof answer === 'boolean') answer = answer ? 'Yes' : 'No';
    const ans = String(answer);
    const valid = options.map((o, i) => ({ o: String(o == null ? '' : o), i })).filter((x) => !isPlaceholder(x.o));
    if (!valid.length) return -1;

    // 1) exact (normalized) match
    const sAns = simplify(ans);
    const exact = valid.find((x) => simplify(x.o) === sAns);
    if (exact) return exact.i;

    // 2) category-aware
    const catName = KEY_CATEGORY[key];
    const catFn = catName && CATEGORY[catName];
    if (catFn) {
      const want = catFn(ans);
      if (want) {
        const hits = valid.filter((x) => catFn(x.o) === want);
        if (hits.length === 1) return hits[0].i;
        if (hits.length > 1) {
          const score = (x) => similarity(x.o, ans) + (acronymMatch(x.o, ans) ? 1 : 0);
          hits.sort((a, b) => score(b) - score(a));
          return hits[0].i;
        }
        if (want === 'decline') return -1; // don't guess a real answer when the user declined
      }
    } else if (/^(yes|no)$/i.test(ans.trim())) {
      // unknown key but a yes/no answer - classify options
      const want = ans.trim().toLowerCase();
      const hits = valid.filter((x) => classifyYesNo(x.o) === want);
      if (hits.length) return hits.sort((a, b) => a.o.length - b.o.length)[0].i;
    }

    // 3) key-specific structures
    if (key === 'country' || key === 'citizenship' || key === 'phoneCountry') {
      const want = countryKey(ans);
      const hits = valid.filter((x) => countryKey(x.o) === want);
      if (hits.length) return hits.sort((a, b) => a.o.length - b.o.length)[0].i;
    }
    if (key === 'phoneCountryCode') {
      const code = ans.replace(/[^\d]/g, '');
      const country = ctx && ctx.country ? countryKey(ctx.country) : 'united states';
      const hits = valid.filter((x) => new RegExp('\\+\\s*' + code + '(?!\\d)').test(x.o) || simplify(x.o) === code);
      if (hits.length) {
        const byCountry = hits.find((x) => countryKey(x.o.replace(/\(.*\)/, '')) === country || simplify(x.o).includes(country));
        return (byCountry || hits[0]).i;
      }
    }
    if (key === 'state') {
      const variants = stateVariants(ans).map(simplify);
      const hits = valid.filter((x) => variants.includes(simplify(x.o)) || variants.some((v) => v.length > 2 && simplify(x.o).startsWith(v + ' ')) || variants.some((v) => simplify(x.o).endsWith(' ' + v) && v.length === 2));
      if (hits.length) return hits.sort((a, b) => a.o.length - b.o.length)[0].i;
    }
    if (/month$/i.test(key || '')) {
      const mi = monthIndex(ans);
      if (mi >= 0) {
        const hit = valid.find((x) => monthIndex(x.o) === mi);
        if (hit) return hit.i;
      }
    }
    if (key === 'yearsExperience' || key === 'desiredSalary' || /year$/i.test(key || '') || key === 'gpa' || key === 'edu.gpa') {
      const exactNum = valid.find((x) => simplify(x.o) === simplify(String(parseNumber(ans))));
      if (exactNum) return exactNum.i;
      const r = pickNumeric(valid.map((x) => x.o), ans);
      if (r >= 0) return valid[r].i;
    }

    // 4) fuzzy text similarity
    let best = -1; let bestScore = 0;
    valid.forEach((x) => {
      const sc = similarity(x.o, ans);
      if (sc > bestScore) { bestScore = sc; best = x.i; }
    });
    if (bestScore >= 0.6) return best;

    // 5) "Other" fallback for source questions
    if (key === 'howDidYouHear') {
      const other = valid.find((x) => /^other\b/i.test(simplify(x.o)));
      if (other) return other.i;
    }
    return -1;
  }

  /** For multi-select checkbox groups: which option indexes to check for a (possibly comma-separated) answer. */
  function pickMany(options, answer, key) {
    if (!Array.isArray(answer) && !['skills', 'languages', 'custom'].includes(key)) {
      // "No, I do not have a disability" is one answer, not two
      const whole = pick(options, answer, key);
      if (whole >= 0) return [whole];
    }
    const parts = Array.isArray(answer) ? answer : String(answer || '').split(/\s*[,;]\s*/).filter(Boolean);
    const out = new Set();
    parts.forEach((p) => { const i = pick(options, p, key); if (i >= 0) out.add(i); });
    return Array.from(out);
  }

  GAF.options = {
    pick, pickMany, similarity, classifyYesNo, isPlaceholder, parseRange, pickNumeric, monthIndex, countryKey, stateVariants,
    US_STATES, COUNTRY_ALIASES, MONTH_NAMES, CATEGORY, KEY_CATEGORY, DECLINE_RE,
  };
})();
