/*
 * Garry AutoFill - profile schema, defaults and storage helpers.
 * Loaded by the options page, the popup, and the content-script bundle.
 * Plain script (no modules) that attaches to globalThis.GAF_SHARED.
 */
(function () {
  'use strict';
  const root = globalThis;
  if (root.GAF_SHARED) return;

  const YES_NO = ['', 'Yes', 'No'];
  const YES_NO_DECLINE = ['', 'Yes', 'No', 'Decline to answer'];
  const MONTHS = ['', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

  /**
   * Declarative schema. The options page renders its form from this, and the
   * content scripts use it to know which keys exist.
   * type: text | email | tel | url | number | date | select | textarea | checkbox
   */
  const PROFILE_SCHEMA = [
    {
      id: 'personal', title: 'Personal information', fields: [
        { key: 'firstName', label: 'First name', autocomplete: 'given-name' },
        { key: 'middleName', label: 'Middle name', autocomplete: 'additional-name' },
        { key: 'lastName', label: 'Last name', autocomplete: 'family-name' },
        { key: 'preferredName', label: 'Preferred / nickname', help: 'Leave blank to reuse your first name.' },
        { key: 'pronouns', label: 'Pronouns', type: 'select', options: ['', 'He/Him', 'She/Her', 'They/Them', 'Decline to answer'] },
        { key: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
        { key: 'phone', label: 'Phone number', type: 'tel', autocomplete: 'tel-national', help: 'National number without country code, e.g. 415 555 0134.' },
        { key: 'phoneCountryCode', label: 'Phone country code', placeholder: '+1' },
        { key: 'phoneType', label: 'Phone type', type: 'select', options: ['Mobile', 'Home', 'Work'] },
      ],
    },
    {
      id: 'address', title: 'Address', fields: [
        { key: 'addressLine1', label: 'Street address', autocomplete: 'address-line1' },
        { key: 'addressLine2', label: 'Apt / suite', autocomplete: 'address-line2' },
        { key: 'city', label: 'City', autocomplete: 'address-level2' },
        { key: 'state', label: 'State / province', autocomplete: 'address-level1', help: 'Full name, e.g. California. Abbreviations are matched automatically.' },
        { key: 'postalCode', label: 'ZIP / postal code', autocomplete: 'postal-code' },
        { key: 'county', label: 'County' },
        { key: 'country', label: 'Country', autocomplete: 'country-name', placeholder: 'United States' },
      ],
    },
    {
      id: 'links', title: 'Links', fields: [
        { key: 'linkedin', label: 'LinkedIn URL', type: 'url' },
        { key: 'github', label: 'GitHub URL', type: 'url' },
        { key: 'portfolio', label: 'Portfolio / personal website', type: 'url' },
        { key: 'twitter', label: 'X / Twitter URL', type: 'url' },
        { key: 'otherUrl', label: 'Other URL', type: 'url' },
      ],
    },
    {
      id: 'job', title: 'Current job & preferences', fields: [
        { key: 'currentCompany', label: 'Current company' },
        { key: 'currentTitle', label: 'Current job title' },
        { key: 'yearsExperience', label: 'Years of professional experience', type: 'number' },
        { key: 'desiredSalary', label: 'Desired salary', help: 'Number only, e.g. 120000.' },
        { key: 'salaryCurrency', label: 'Salary currency', placeholder: 'USD' },
        { key: 'noticePeriod', label: 'Notice period', placeholder: '2 weeks' },
        { key: 'availableStartDate', label: 'Earliest start date', type: 'date' },
        { key: 'workPreference', label: 'Work arrangement preference', type: 'select', options: ['', 'Remote', 'Hybrid', 'On-site', 'Flexible'] },
        { key: 'skills', label: 'Skills', type: 'textarea', help: 'Comma separated. Used only for fields that ask for a skills list.' },
        { key: 'languages', label: 'Languages spoken', help: 'Comma separated, e.g. English, Spanish.' },
      ],
    },
    {
      id: 'eligibility', title: 'Eligibility & screening answers', fields: [
        { key: 'authorizedToWork', label: 'Legally authorized to work in the country of the job?', type: 'select', options: YES_NO },
        { key: 'requireSponsorship', label: 'Will you now or in the future require visa sponsorship?', type: 'select', options: YES_NO },
        { key: 'citizenship', label: 'Country of citizenship', placeholder: 'United States' },
        { key: 'over18', label: 'Are you 18 years or older?', type: 'select', options: YES_NO },
        { key: 'willingToRelocate', label: 'Willing to relocate?', type: 'select', options: YES_NO },
        { key: 'willingToTravel', label: 'Willing to travel?', type: 'select', options: YES_NO },
        { key: 'previouslyEmployed', label: 'Previously employed by the company you apply to?', type: 'select', options: YES_NO, help: 'Usually "No". Change per application if needed.' },
        { key: 'relativesAtCompany', label: 'Relatives / close contacts working at the company?', type: 'select', options: YES_NO },
        { key: 'driversLicense', label: "Valid driver's license?", type: 'select', options: YES_NO },
        { key: 'backgroundCheck', label: 'Willing to undergo a background check / drug test?', type: 'select', options: YES_NO },
        { key: 'securityClearance', label: 'Active security clearance', placeholder: 'None' },
        { key: 'nonCompete', label: 'Bound by a non-compete / non-solicit agreement?', type: 'select', options: YES_NO },
        { key: 'smsConsent', label: 'Opt in to recruiting text messages?', type: 'select', options: YES_NO },
      ],
    },
    {
      id: 'source', title: 'How did you hear about us', fields: [
        { key: 'howDidYouHear', label: 'Default source', placeholder: 'LinkedIn', help: 'Matched against the options each site offers (LinkedIn, Indeed, Company website, Referral...).' },
        { key: 'referrerName', label: 'Referrer name (if any)' },
      ],
    },
    {
      id: 'eeo', title: 'Voluntary self-identification (EEO)', note: 'Optional. Leave blank to skip these questions, or choose "Decline" to answer with the site\'s decline option.', fields: [
        { key: 'gender', label: 'Gender', type: 'select', options: ['', 'Male', 'Female', 'Non-binary', 'Decline to answer'] },
        { key: 'transgender', label: 'Do you identify as transgender?', type: 'select', options: YES_NO_DECLINE },
        { key: 'sexualOrientation', label: 'Sexual orientation', type: 'select', options: ['', 'Heterosexual', 'Gay', 'Lesbian', 'Bisexual', 'Queer', 'Asexual', 'Decline to answer'] },
        { key: 'hispanicLatino', label: 'Hispanic or Latino?', type: 'select', options: YES_NO_DECLINE },
        {
          key: 'race', label: 'Race / ethnicity', type: 'select', options: ['', 'American Indian or Alaska Native', 'Asian', 'Black or African American', 'Hispanic or Latino',
            'Native Hawaiian or Other Pacific Islander', 'White', 'Two or More Races', 'Decline to answer'],
        },
        { key: 'veteran', label: 'Veteran status', type: 'select', options: ['', 'I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', 'Decline to answer'] },
        { key: 'disability', label: 'Disability status', type: 'select', options: ['', 'No, I do not have a disability', 'Yes, I have a disability (or previously had one)', 'Decline to answer'] },
      ],
    },
    {
      id: 'experience', title: 'Work experience', repeat: true, addLabel: 'Add position', fields: [
        { key: 'title', label: 'Job title' },
        { key: 'company', label: 'Company' },
        { key: 'location', label: 'Location', placeholder: 'San Francisco, CA' },
        { key: 'startMonth', label: 'Start month', type: 'select', options: MONTHS },
        { key: 'startYear', label: 'Start year', type: 'number' },
        { key: 'endMonth', label: 'End month', type: 'select', options: MONTHS },
        { key: 'endYear', label: 'End year', type: 'number' },
        { key: 'current', label: 'I currently work here', type: 'checkbox' },
        { key: 'description', label: 'Description', type: 'textarea' },
      ],
    },
    {
      id: 'education', title: 'Education', repeat: true, addLabel: 'Add school', fields: [
        { key: 'school', label: 'School / university' },
        { key: 'degree', label: 'Degree', placeholder: "Bachelor's" },
        { key: 'fieldOfStudy', label: 'Field of study / major' },
        { key: 'gpa', label: 'GPA' },
        { key: 'startMonth', label: 'Start month', type: 'select', options: MONTHS },
        { key: 'startYear', label: 'Start year', type: 'number' },
        { key: 'endMonth', label: 'End month', type: 'select', options: MONTHS },
        { key: 'endYear', label: 'End / graduation year', type: 'number' },
      ],
    },
    {
      id: 'customAnswers', title: 'Custom answers', repeat: true, addLabel: 'Add rule',
      note: 'Your own rules for recurring questions. "Question contains" is a comma-separated list of keywords (all must appear) or /regex/. Checked before the built-in rules. Essay questions are still yours to answer unless you add a rule here.',
      fields: [
        { key: 'match', label: 'Question contains', placeholder: 'notice, period' },
        { key: 'answer', label: 'Answer', placeholder: '2 weeks' },
      ],
    },
  ];

  const DEFAULT_PROFILE = {
    phoneCountryCode: '+1',
    phoneType: 'Mobile',
    country: 'United States',
    salaryCurrency: 'USD',
    howDidYouHear: 'LinkedIn',
    experience: [],
    education: [],
    customAnswers: [],
  };

  const DEFAULT_SETTINGS = {
    autoFillOnAtsSites: true, // fill automatically when a supported ATS form (or a new wizard step) appears
    showFloatingButton: true,
    overwriteExisting: false, // never replace values that are already present
    highlightFields: true,
    fillEEO: true,
    addMissingEntries: true, // click "Add work experience/education" buttons when the profile has more entries
    uploadResume: true,
    debug: false,
  };

  const KEYS = { profile: 'gaf_profile', settings: 'gaf_settings', files: 'gaf_files' };

  function hasChromeStorage() {
    return !!(root.chrome && root.chrome.storage && root.chrome.storage.local);
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      if (!hasChromeStorage()) return resolve({});
      root.chrome.storage.local.get(keys, (res) => resolve(res || {}));
    });
  }

  function storageSet(obj) {
    return new Promise((resolve, reject) => {
      if (!hasChromeStorage()) return resolve();
      root.chrome.storage.local.set(obj, () => {
        const err = root.chrome.runtime && root.chrome.runtime.lastError;
        if (err) reject(new Error(err.message)); else resolve();
      });
    });
  }

  async function loadAll() {
    const res = await storageGet([KEYS.profile, KEYS.settings, KEYS.files]);
    return {
      profile: Object.assign({}, DEFAULT_PROFILE, res[KEYS.profile] || {}),
      settings: Object.assign({}, DEFAULT_SETTINGS, res[KEYS.settings] || {}),
      files: res[KEYS.files] || {},
    };
  }

  const saveProfile = (profile) => storageSet({ [KEYS.profile]: profile });
  const saveSettings = (settings) => storageSet({ [KEYS.settings]: settings });
  const saveFiles = (files) => storageSet({ [KEYS.files]: files });

  root.GAF_SHARED = {
    PROFILE_SCHEMA, DEFAULT_PROFILE, DEFAULT_SETTINGS, KEYS,
    loadAll, saveProfile, saveSettings, saveFiles, storageGet, storageSet,
  };
})();
