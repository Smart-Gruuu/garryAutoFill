# Writing a site adapter

The content bundle (`src/content/bundle-files.js`) is injected into any frame that looks like a job application.
All files are classic scripts sharing one isolated-world global, `globalThis.GAF`. Wrap every file in an IIFE — never
declare top-level `const`/`let` (the bundle can be injected twice).

## Pipeline

```
engine.run()
  adapter = detectAdapter()                   first adapter whose match() is true, else "generic"
  adapter.prepare(ctx)                        optional: e.g. click "Add Work Experience" buttons
  repeat up to 4 passes (new fields may appear after a choice):
    fields = fields.collect(ctx)              generic collection (inputs, selects, textareas, radios, checkboxes,
                                              [role=combobox], button[aria-haspopup=listbox], ARIA radio groups)
    fields = adapter.collect(fields, ctx)     optional: add/replace/remove descriptors
    field.classification = adapter.classify(field, ctx) || classifier.classify(field, ctx)
    engine.assignIndices(fields)              exp.* / edu.* entries get field.index (heading "Work Experience 2" or occurrence count)
    for each field (resume first, then country, then document order):
      skip if classification.skip             (essay | consent | sensitive | unknown)
      skip if not empty                       adapter.isEmpty(field) ?? fields.isEmpty(field)
      answer = adapter.resolve(key, field) ?? answers.resolve(key, field)
      ok = adapter.fill(field, answer, ctx) ?? engine.defaultFill(field, answer, ctx)
  adapter.afterFill(ctx)
  ui.highlight + ui.showReport
```

## Field descriptor (see `src/content/core/fields.js`)

| prop | meaning |
|---|---|
| `kind` | `text` `textarea` `date` `select` `radio` `checkbox` `checkboxGroup` `file` `combobox` `ariaRadio` `ariaCheckbox` — adapters may introduce their own kinds (e.g. `workdayDate`) as long as their `fill`/`isEmpty` handle them |
| `el` | primary element (for groups: first member) |
| `members` | group members |
| `label` / `question` | cleaned label text / group question |
| `options` | option texts for select/radio/checkboxGroup/ariaRadio |
| `attrs` | humanized `name id data-automation-id autocomplete …` |
| `section` | nearest preceding headings, nearest first |
| `order`, `inputType`, `autocomplete`, `required` | |
| `index` | set by the adapter or engine for repeated sections |
| `markEl` | element to outline in highlights (optional) |

## Classification keys

Returned by `classifier.classify` (or your `adapter.classify`): `{ key }` or `{ skip: 'essay'|'consent'|'sensitive'|'unknown', reason }`.
Keys: `firstName middleName lastName preferredName fullName pronouns email confirmEmail phone phoneCountryCode phoneExtension phoneType
addressLine1 addressLine2 city county state postalCode country location linkedin github twitter portfolio otherUrl resume coverLetterFile
currentCompany currentTitle yearsExperience desiredSalary salaryCurrency noticePeriod availableStartDate workPreference
authorizedToWork requireSponsorship authorizedNoSponsorship isCitizen citizenship over18 willingToRelocate willingToTravel previouslyEmployed
relativesAtCompany hasReferral referrerName howDidYouHear driversLicense backgroundCheck securityClearance nonCompete smsConsent
gender transgender sexualOrientation hispanicLatino race veteran disability highestEducation languages skills custom`
and repeated `exp.{title,company,location,description,current,startMonth,startYear,endMonth,endYear,startDate,endDate}`,
`edu.{school,degree,field,gpa,startMonth,startYear,endMonth,endYear,graduationYear,startDate,endDate}`.

An answer is `{ value, query? }` — `value` is text/`'Yes'`/`'No'`/option-ish text, or a file record `{name,type,dataUrl}` with `file: true`.
Pick options with `GAF.options.pick(optionTexts, value, key, { country })` — it understands yes/no phrasing, EEO decline variants,
states/abbreviations, countries, degrees, months, numeric ranges.

## Tools you can use

- `GAF.dom`: `deepQueryAll/deepQuery` (shadow-DOM aware), `closestComposed`, `isVisible`, `textOf`, `labelFor`, `ownLabel`, `groupQuestion`
- `GAF.set`: `setText(el, value, {typing, blur})`, `setSelect(select, index)`, `setChecked(input, bool)`, `setAriaChecked`,
  `setFile(input, fileRecord)`, `dropFile(zone, fileRecord)`, `setCombobox(trigger, chooseFn, {query, searchInput, allowFirstResult})`,
  `safeClick(el, {allowText})`, `pressKey(el, key)`, `fire(el, type, init)`, `optionsFor(trigger)`, `withSubmitGuard(fn)`
- `GAF.util`: `sleep`, `waitFor(fn, {timeout})`, `normalize`, `simplify`, `cleanLabel`, `log`

## Hard rules

1. Never click submit / next / continue / save / apply / sign-in buttons. `GAF.set.safeClick` refuses them; only pass
   `allowText` for explicit "Add …" section buttons, and only in `prepare`.
2. Never fill passwords, never create accounts, never touch CAPTCHAs.
3. Do not overwrite non-empty values (the engine checks `isEmpty`; make `adapter.isEmpty` accurate for custom widgets —
   e.g. a Workday dropdown button whose text is "Select One" is empty).
4. Essay questions stay empty; agreements/signatures stay unticked (the generic classifier handles this — keep it that way).
5. Be idempotent: the engine may run again when the DOM changes (auto-fill on wizard steps).

## Tests

`tests/harness.js` loads the real bundle into jsdom with a fixture page (inline `<script>`s run, so a fixture can emulate a
widget's behaviour — e.g. a button that opens a `role=listbox` portal). Write `tests/<ats>.test.js` using
`loadPage({ html, url })` with a URL on the ATS host so your adapter is detected. Run `npm test` or `node tests/run.js <ats>`.
