# Garry AutoFill — job application autofill for Chrome

A Chrome extension (Manifest V3) that fills job applications from one saved profile. Every applicant tracking system
builds its forms differently, so the extension has a shared fill engine plus a small adapter for each ATS.

**What it fills:** name, contact details, address, links, resume upload, work authorization and sponsorship, relocation,
"how did you hear about us", salary expectations, start date, work history, education, and optional EEO self-identification.

**What it leaves for you:**
- **Open-ended questions** such as "Why are you interested in this role?", "Tell us about…", cover-letter text boxes and
  "Additional information". They get an amber dashed outline and appear in the "for you" list.
- **Agreements, attestations and e-signatures**: privacy policy boxes, "I certify…", "type your full name to sign".
- **Sensitive data**: SSN, date of birth, bank details, salary history, criminal-history questions.
- **Submitting.** The extension never clicks Submit, Next, Continue or Save, and it blocks any form submission that happens
  while it is filling.

## Supported sites

| ATS | Hosts |
|---|---|
| Workday | `*.myworkdayjobs.com`, `*.myworkdaysite.com`, `*.myworkday.com` |
| Greenhouse | `boards.greenhouse.io`, `job-boards.greenhouse.io`, embedded boards |
| Lever | `jobs.lever.co` |
| Ashby | `jobs.ashbyhq.com` |
| iCIMS | `*.icims.com` (including the `icims_content_iframe`) |
| Jobvite | `jobs.jobvite.com` |
| ADP | `workforcenow.adp.com`, `myjobs.adp.com`, `recruiting.adp.com` |
| UKG Pro (UltiPro) | `recruiting.ultipro.com`, `*.ukg.net` |
| Paylocity | `recruiting.paylocity.com` |
| Dayforce | `jobs.dayforcehcm.com` |
| BambooHR | `*.bamboohr.com/careers` |
| SmartRecruiters | `jobs.smartrecruiters.com` |
| Workable | `apply.workable.com` |
| JazzHR | `*.applytojob.com` |
| Breezy HR | `*.breezy.hr` |
| Oracle Recruiting Cloud | `*.oraclecloud.com` |
| Taleo | `*.taleo.net` |
| SAP SuccessFactors | `*.successfactors.com`, `*.successfactors.eu`, `*.sapsf.com` |
| Any other site | Generic matching on labels, `name`/`id` and `autocomplete` attributes (use the button or shortcut) |

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked** and pick this folder (the one that contains `manifest.json`).
4. The profile page opens. Fill it in once and upload your resume. Everything autosaves.

## Use

- Open an application. On supported sites the form fills itself when it appears, including each new Workday wizard step.
- Anywhere else, click the round ⚡ button in the corner of the page, press **Alt+Shift+F**, use the toolbar popup, or
  right-click and choose **Autofill this job application**.
- A panel lists what was filled and what still needs you. Click an item to jump to that field.
- Outline colours: green means filled, amber dashed means left for you, and red means the extension could not set the field.

Turn off automatic filling in the popup or on the profile page (**Behaviour**) if you prefer to trigger it yourself.

### Site notes

- **Workday**: after **Next**, you sign in or create the account yourself. Each later step fills as it appears, and extra
  Work Experience, Education and Website panels are added to match your profile.
- **iCIMS**: iCIMS reads a resume as soon as it is attached, so it reloads the page. The extension attaches your resume
  first, then fills everything else after the reload. It never uploads the resume twice. The Login and Password boxes
  on new accounts are left for you.

### Custom answers

In **Custom answers**, write rules for questions that keep coming up. A rule matches when the question contains all of
its comma-separated keywords, or you can write a `/regex/`. For example, `years, python` → `5`. Rules run before the
built-in matching and also work on essay-style questions if you want to reuse a stock answer.

## Privacy

Your profile and files are kept in `chrome.storage.local` in this browser. The extension makes no network requests and
has no analytics. **Backup → Export JSON** copies your profile to another browser.

## Development

```
npm install         # jsdom + puppeteer (downloads Chrome for Testing)
npm test            # unit/fixture tests in jsdom, plus packaging checks
npm run e2e         # loads the unpacked extension in real Chrome and fills fixture pages (HEADFUL=1 to watch)
npm run check       # fails if any extension script contains non-ASCII characters
node tools/ascii-escape.js   # fixes them (Chrome rejects some characters as "not UTF-8 encoded")
node tools/serve.js # static server for previewing src/options and fixtures
node tools/make-icons.js
```

- `src/content/loader.js` runs in every frame and only checks whether the frame looks like an application form.
- `src/background/service-worker.js` injects the bundle listed in `src/content/bundle-files.js` into those frames and
  sends fill requests to every frame of the tab.
- `src/content/core/*` holds the engine: field collection that reaches into shadow DOM, the label classifier, option
  matching, framework-safe setters, and the in-page UI.
- `src/content/adapters/*` has one file per ATS. [docs/ADAPTERS.md](docs/ADAPTERS.md) explains how to write one.
