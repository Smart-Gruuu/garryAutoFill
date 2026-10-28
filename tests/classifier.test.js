const assert = require('assert');
const { loadPage } = require('./harness');

let pagePromise = null;
const gaf = async () => {
  if (!pagePromise) pagePromise = loadPage({ html: '<!doctype html><body></body>' });
  return (await pagePromise).GAF;
};

const profile = require('./fixtures/profile').profile;

function field(kind, label, extra) {
  return Object.assign({ kind, label, question: '', attrs: '', section: [], options: null, inputType: kind === 'text' ? 'text' : '' }, extra || {});
}

async function cls(kind, label, extra) {
  const G = await gaf();
  return G.classifier.classify(field(kind, label, extra), { profile: Object.assign({}, profile, { customAnswers: [] }) });
}

const KEY_CASES = [
  ['text', 'First Name', 'firstName'],
  ['text', 'Legal First Name', 'firstName'],
  ['text', 'Given name(s)', 'firstName'],
  ['text', 'Last Name', 'lastName'],
  ['text', 'Family name / Surname', 'lastName'],
  ['text', 'Preferred First Name', 'preferredName'],
  ['text', 'Full name', 'fullName'],
  ['text', 'Name', 'fullName'],
  ['text', 'Email', 'email'],
  ['text', 'Email Address', 'email'],
  ['text', 'Confirm your email address', 'confirmEmail'],
  ['text', 'Phone', 'phone'],
  ['text', 'Mobile phone number', 'phone'],
  ['select', 'Phone Device Type', 'phoneType'],
  ['select', 'Country Phone Code', 'phoneCountryCode'],
  ['text', 'Address Line 1', 'addressLine1'],
  ['text', 'Address Line 2', 'addressLine2'],
  ['text', 'City', 'city'],
  ['select', 'State', 'state'],
  ['select', 'State/Province', 'state'],
  ['text', 'Postal Code', 'postalCode'],
  ['text', 'ZIP', 'postalCode'],
  ['select', 'Country', 'country'],
  ['combobox', 'Location (City)', 'location'],
  ['text', 'Current location', 'location'],
  ['text', 'LinkedIn Profile', 'linkedin'],
  ['text', 'LinkedIn URL', 'linkedin'],
  ['text', 'GitHub', 'github'],
  ['text', 'Portfolio URL', 'portfolio'],
  ['text', 'Website', 'portfolio'],
  ['file', 'Resume/CV', 'resume'],
  ['file', 'Cover Letter', 'coverLetterFile'],
  ['text', 'Current Company', 'currentCompany'],
  ['text', 'Current Title', 'currentTitle'],
  ['select', 'How many years of professional experience do you have?', 'yearsExperience'],
  ['text', 'Desired salary', 'desiredSalary'],
  ['text', 'What are your salary expectations?', 'desiredSalary'],
  ['radio', 'Are you legally authorized to work in the United States?', 'authorizedToWork'],
  ['radio', 'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?', 'requireSponsorship'],
  ['select', 'Are you authorized to work in the US without the need for employer sponsorship?', 'authorizedNoSponsorship'],
  ['radio', 'Are you at least 18 years of age?', 'over18'],
  ['radio', 'Are you willing to relocate?', 'willingToRelocate'],
  ['radio', 'Have you previously worked for Acme Corp?', 'previouslyEmployed'],
  ['radio', 'Have you ever been employed by this company or any of its subsidiaries?', 'previouslyEmployed'],
  ['select', 'How did you hear about us?', 'howDidYouHear'],
  ['combobox', 'How Did You Hear About Us?', 'howDidYouHear'],
  ['select', 'Gender', 'gender'],
  ['select', 'Are you Hispanic/Latino?', 'hispanicLatino', { options: ['Yes', 'No', 'Decline To Self Identify'] }],
  ['select', 'Race', 'race'],
  ['select', 'Please select the ethnicity (or ethnicities) which most accurately describe(s) how you identify yourself', 'race'],
  ['select', 'Veteran Status', 'veteran'],
  ['select', 'Disability Status', 'disability'],
  ['radio', 'Do you have a valid driver\'s license?', 'driversLicense'],
  ['select', 'Pronouns', 'pronouns'],
  ['select', 'What is your highest level of education?', 'highestEducation'],
  ['text', 'Earliest start date', 'availableStartDate'],
  ['text', 'When can you start?', 'availableStartDate'],
  ['text', 'Referrer name', 'referrerName'],
];

for (const [kind, label, key, extra] of KEY_CASES) {
  test(`classifies "${label}" (${kind}) as ${key}`, async () => {
    const c = await cls(kind, label, extra);
    assert.strictEqual(c.key, key, JSON.stringify(c));
  });
}

const SKIP_CASES = [
  ['textarea', 'Why are you interested in this role?', 'essay'],
  ['text', 'Why do you want to join Stripe?', 'essay'],
  ['textarea', 'Tell us about a project you are proud of.', 'essay'],
  ['textarea', 'What interests you about working at Figma?', 'essay'],
  ['textarea', 'Cover Letter', 'essay'],
  ['textarea', 'Additional Information', 'essay'],
  ['textarea', 'Is there anything else you would like us to know?', 'essay'],
  ['text', 'Describe your experience with distributed systems', 'essay'],
  ['textarea', 'How would you approach designing a rate limiter?', 'essay'],
  ['textarea', 'Please share a link to a project and explain your role (in 200 words or less)', 'essay'],
  ['checkbox', 'I have read and agree to the Privacy Policy', 'consent'],
  ['checkbox', 'I certify that the information provided is true and complete', 'consent'],
  ['checkbox', 'Yes, I would like to receive text messages about my application', 'consent'],
  ['text', 'Signature', 'consent'],
  ['text', "Today's Date", 'consent'],
  ['text', 'Social Security Number', 'sensitive'],
  ['text', 'Date of Birth', 'sensitive'],
  ['text', 'What is your current salary?', 'sensitive'],
  ['radio', 'Have you ever been convicted of a felony?', 'sensitive'],
];

for (const [kind, label, skip] of SKIP_CASES) {
  test(`leaves "${label}" (${kind}) for the user as ${skip}`, async () => {
    const c = await cls(kind, label);
    assert.strictEqual(c.skip, skip, JSON.stringify(c));
  });
}

test('essay-looking choice questions are still structured', async () => {
  const c = await cls('select', 'Please describe your years of experience', { options: ['0-2', '3-5', '6-10', '10+'] });
  assert.notStrictEqual(c.skip, 'essay');
});

test('experience section fields map to exp.* and education to edu.*', async () => {
  let c = await cls('text', 'Job Title', { section: ['Work Experience 1', 'My Experience'] });
  assert.strictEqual(c.key, 'exp.title');
  c = await cls('text', 'Company', { section: ['Work Experience 1'] });
  assert.strictEqual(c.key, 'exp.company');
  c = await cls('checkbox', 'I currently work here', { section: ['Work Experience 1'] });
  assert.strictEqual(c.key, 'exp.current');
  c = await cls('textarea', 'Role Description', { section: ['Work Experience 1'] });
  assert.strictEqual(c.key, 'exp.description');
  c = await cls('text', 'School or University', { section: ['Education 1'] });
  assert.strictEqual(c.key, 'edu.school');
  c = await cls('select', 'Degree', { section: ['Education 1'] });
  assert.strictEqual(c.key, 'edu.degree');
  c = await cls('text', 'Field of Study', { section: ['Education 1'] });
  assert.strictEqual(c.key, 'edu.field');
});

test('custom answer rules win over built-in and essay rules', async () => {
  const G = await gaf();
  const c = G.classifier.classify(field('textarea', 'Why do you want to relocate to Austin?'), { profile: { customAnswers: [{ match: 'relocate, austin', answer: 'Family nearby.' }] } });
  assert.strictEqual(c.key, 'custom');
});

// ------------------------------------------------------------------------ option matching

const PICK_CASES = [
  [['Yes', 'No'], 'Yes', 'authorizedToWork', 'Yes'],
  [['Yes, I am authorized', 'No, I am not authorized'], 'No', 'authorizedToWork', 'No, I am not authorized'],
  [['I will require sponsorship', 'I will not require sponsorship'], 'No', 'requireSponsorship', 'I will not require sponsorship'],
  [['Select...', 'Male', 'Female', 'Decline To Self Identify'], 'Decline to answer', 'gender', 'Decline To Self Identify'],
  [['Man', 'Woman', 'Non-binary', "I don't wish to answer"], 'Female', 'gender', 'Woman'],
  [['Male', 'Female'], 'Female', 'gender', 'Female'],
  [['I am a protected veteran', 'I am not a protected veteran', "I don't wish to answer"], 'I am not a protected veteran', 'veteran', 'I am not a protected veteran'],
  [['I identify as one or more of the classifications of protected veteran', 'I am not a protected veteran', 'I do not wish to self-identify'], 'Decline to answer', 'veteran', 'I do not wish to self-identify'],
  [['Yes, I have a disability (or previously had a disability)', 'No, I do not have a disability', 'I do not want to answer'], 'No, I do not have a disability', 'disability', 'No, I do not have a disability'],
  [['Hispanic or Latino', 'White (Not Hispanic or Latino)', 'Asian (Not Hispanic or Latino)', 'Two or More Races (Not Hispanic or Latino)'], 'Asian', 'race', 'Asian (Not Hispanic or Latino)'],
  [['Alabama', 'California', 'Colorado'], 'CA', 'state', 'California'],
  [['AL', 'CA', 'CO'], 'California', 'state', 'CA'],
  [['Canada', 'United States of America', 'United Kingdom'], 'United States', 'country', 'United States of America'],
  [['USA', 'Canada'], 'United States', 'country', 'USA'],
  [['United States of America (+1)', 'Canada (+1)', 'India (+91)'], '+1', 'phoneCountryCode', 'United States of America (+1)'],
  [['High School', "Bachelor's Degree", "Master's Degree", 'Doctorate'], "Bachelor's", 'edu.degree', "Bachelor's Degree"],
  [['BA', 'BS', 'MS', 'PhD'], 'Bachelor of Science', 'edu.degree', 'BS'],
  [['January', 'February', 'March'], '03', 'exp.startMonth', 'March'],
  [['0-1 years', '1-3 years', '3-5 years', '5-10 years', '10+ years'], '7', 'yearsExperience', '5-10 years'],
  [['Less than 1 year', '1 to 2 years', '3 to 5 years', 'More than 5 years'], '7', 'yearsExperience', 'More than 5 years'],
  [['LinkedIn', 'Indeed', 'Company Website', 'Referral', 'Other'], 'LinkedIn', 'howDidYouHear', 'LinkedIn'],
  [['Job board', 'Social media - LinkedIn', 'Employee referral'], 'LinkedIn', 'howDidYouHear', 'Social media - LinkedIn'],
  [['Glassdoor', 'Indeed', 'Other'], 'LinkedIn', 'howDidYouHear', 'Other'],
  [['Mobile', 'Home', 'Work'], 'Mobile', 'phoneType', 'Mobile'],
  [['Cell Phone', 'Landline'], 'Mobile', 'phoneType', 'Cell Phone'],
];

for (const [options, answer, key, expected] of PICK_CASES) {
  test(`pick "${answer}" for ${key} from [${options.join(' | ')}]`, async () => {
    const G = await gaf();
    const i = G.options.pick(options, answer, key, { country: 'United States' });
    assert.strictEqual(options[i], expected);
  });
}

test('declined EEO answer never picks a real option when there is no decline option', async () => {
  const G = await gaf();
  assert.strictEqual(G.options.pick(['Male', 'Female'], 'Decline to answer', 'gender'), -1);
});
