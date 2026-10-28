/*
 * Garry AutoFill - maps a collected field (label/question text + attributes + section) to a profile key,
 * or decides to leave it for the human (essay questions, consent/attestation, sensitive data).
 *
 * classify(field, ctx) -> { key, score, via } | { skip: 'essay'|'consent'|'sensitive'|'unknown', reason } | { custom: rule }
 */
(function () {
  'use strict';
  const GAF = (globalThis.GAF = globalThis.GAF || {});
  if (GAF.classifier) return;
  const { normalize } = GAF.util;

  const TEXTISH = ['text', 'textarea', 'date', 'combobox'];
  const CHOICE = ['select', 'radio', 'combobox', 'checkboxGroup', 'ariaRadio'];
  const ANY = null;

  // Sections
  const EXP_SECTION = /\b(work|employment|professional|job|career)\s*(experience|history)\b|\bexperience\s*\d*$|\bemployment\b|\bwork history\b|\bprevious (employer|job)s?\b|\bpositions?\s*held\b/;
  const EDU_SECTION = /\beducation(al)?\b|\bschool(ing)?\b|\bacademic\b|\bdegrees?\b|\bqualifications?\b/;

  // ---------------------------------------------------------------------------------------------
  // Leave-for-human detectors

  const SENSITIVE_RE = new RegExp([
    'social security', '\\bssn\\b', '\\bsocial insurance\\b', '\\bsin (number|#)', 'national (id|identification|insurance)', 'passport', '\\btax (id|file|identification)', '\\b(itin|tin)\\b',
    'date of birth', 'birth ?date', '\\bdob\\b', 'birthday', 'place of birth', 'what is your age', '^(your )?age\\??$', 'how old are you','mother\'?s maiden',
    '\\bbank\\b', 'routing (number|#)', 'account (number|#)', 'credit card', 'card number', '\\bcvv\\b', 'iban',
    'driver\'?s?\\s*licen[cs]e\\s*(number|#|no\\b|id)', 'licen[cs]e (number|#)', '\\bpassword\\b', 'security (question|answer)', '\\bpin\\b',
    'salary history', 'current (base )?(salary|compensation|pay|wage)', '(previous|prior|last|most recent) (salary|compensation|pay)', 'what (is|was) your (current|previous) (salary|compensation)',
    'criminal', 'convicted', 'conviction', 'felony', 'misdemeanor', '\\barrest', 'pending charges', 'marital status', 'religio', 'pregnan', 'medical condition', 'genetic',
  ].join('|'));

  const CONSENT_CHECK_RE = /\b(i )?(agree|acknowledge|certify|consent|attest|accept|understand|authori[sz]e|declare|affirm|confirm that|have read)\b|privacy (policy|notice|statement)|terms (and|&) conditions|terms of (use|service)|data (processing|protection|retention)|\bgdpr\b|by (checking|clicking|submitting|providing)|\bopt.?in\b|subscribe|newsletter|job alerts?|talent (community|network|pool)|keep me (informed|updated)|future (opportunities|openings|roles|job)|marketing|text messages?|\bsms\b|receive (texts|messages|communications|updates)|e-?sign|signature|disclaimer|true and (complete|correct|accurate)|falsif/;

  const SIGNATURE_TEXT_RE = /\bsignature\b|\be-?sign|\bsign(ed)? (your )?(full )?(legal )?name\b|type your (full )?(legal )?name|electronic(ally)? sign|\binitials\b|today'?s date|date signed|signature date|^date$/;

  const ESSAY_RE = new RegExp([
    '\\bwhy\\b',
    '\\btell (us|me)\\b', '\\bdescribe\\b', '\\bexplain\\b', '\\belaborate\\b', '\\bwalk (us|me) through\\b',
    '\\bshare (an?|your|with us|more|some|any|how|why|what|a bit)\\b',
    '\\bwhat (interests|excites|attracts|draws|motivates|inspires|appeals|intrigues)\\b', '\\bwhat about\\b', '\\bwhat makes you\\b',
    '\\bhow (would|will|do|did|have|can|could|might) you\\b(?!.*\\b(hear|heard|find|found|learn|learned|discover|come across|refer)\\b)',
    '\\bgive (us )?(an? )?example', '\\bprovide (an? |some |specific )?(example|detail)', '\\bexample of\\b', '\\ba time (when|that|where)\\b', '\\bin your own words\\b',
    '\\bcover letter\\b', '\\bmotivation\\b', '\\bmotivates you\\b', '\\bpersonal statement\\b', '\\bstatement of (interest|purpose)\\b', '\\bessay\\b',
    '\\banything else\\b', '\\badditional (information|info|comments|details|notes|context)\\b', '\\bother (information|comments|details)\\b', '\\bcomments?\\b$',
    '\\b(biggest|greatest|proudest|most (significant|challenging|impactful|interesting))\\b', '\\b(accomplishment|achievement)s?\\b',
    '\\binterest(ed)? in (this|the|our|joining) (role|position|job|company|opportunity|team|work)\\b', '\\bexcited about\\b', '\\bpassionate about\\b',
    '\\bin (\\d+|a few|one|two|three) (words|sentences|paragraphs|characters)\\b', '\\b\\d+ (words|characters) or (less|fewer)\\b', '\\b(word|character) (limit|count)\\b',
    '\\bwhat (would|do|did|are|is|was|were) (you|your)\\b.*\\b(proud|approach|goal|passion|strength|weakness|challenge|learn|looking for|hope|expect|contribut|bring|favorite|think|idea|vision|philosophy|opinion)',
    '\\bsummar(y|ize) (of|your)\\b', '\\bthoughts on\\b', '\\bfeedback\\b', '\\bideas?\\b.*\\?$',
  ].join('|'));

  // ---------------------------------------------------------------------------------------------
  // Profile key rules. Order matters for ties: more specific rules first.
  // label: regex against the label/question text   attr: regex against name/id/automation-id text
  // not:   veto regex against the text              kinds: allowed field kinds (null = any)
  // ac:    autocomplete tokens                       maxLen: ignore label matches on longer texts
  // section: 'exp' | 'edu' | '!repeat' (must NOT be inside exp/edu section)
  // options: function(optionTexts) -> bool, must hold for choice fields

  const NAME_NOT = /company|employer|organi[sz]ation|school|university|college|refer|emergency|reference|manager|supervisor|recruiter|parent|guardian|spouse|partner|contact person|relative|family member|file|user ?name|account|business|legal entity|signature|doctor|physician|pharmacy|institution|project|product|job|position|role|degree|dog|pet|father|mother|middle|preferred|nick/;

  const yesNoOptions = (opts) => opts.filter((o) => GAF.options.classifyYesNo(o)).length >= 2;

  const RULES = [
    // --- identity
    { key: 'firstName', label: /\b(first|given|fore)[\s-]*name\b|^first$|\blegal first\b|^name \(first\)$/, attr: /\b(first ?name|given ?name|fname|forename|first)\b/, ac: ['given-name'], not: NAME_NOT, kinds: ['text', 'combobox'], maxLen: 60 },
    { key: 'middleName', label: /\bmiddle[\s-]*(name|initial)s?\b/, attr: /\bmiddle ?(name|initial)\b/, ac: ['additional-name'], not: /company|school|refer/, kinds: ['text'], maxLen: 60 },
    { key: 'lastName', label: /\b(last|family|sur)[\s-]*name\b|^last$|\bsurname\b|\blegal last\b/, attr: /\b(last ?name|family ?name|surname|lname|last)\b/, ac: ['family-name'], not: NAME_NOT, kinds: ['text', 'combobox'], maxLen: 60 },
    { key: 'preferredName', label: /\b(preferred|nick|chosen)[\s-]*(first[\s-]*)?name\b|name you (prefer|go by)|\bgo(es)? by\b/, attr: /\b(preferred ?(first )?name|nick ?name)\b/, not: /pronoun|company|school/, kinds: ['text'], maxLen: 80 },
    { key: 'pronouns', label: /\bpronouns?\b/, attr: /\bpronoun/, kinds: ['text', 'select', 'radio', 'combobox', 'checkboxGroup'] },
    { key: 'fullName', label: /^(your |full |legal |candidate |applicant )*(full )?name$|\bfull (legal )?name\b|^name \(first and last\)$|^first and last name$/, attr: /^(name|full ?name|candidate ?name|applicant ?name|your ?name)$/, ac: ['name'], not: /company|employer|school|refer|emergency|reference|signature|user ?name|file|manager|supervisor|recruiter|contact|business|legal entity|dog|project|job|position/, kinds: ['text'], maxLen: 40 },

    // --- contact
    { key: 'confirmEmail', label: /\b(confirm|re-?enter|re-?type|verify|repeat)\b.*\be-?mail\b|\be-?mail\b.*\b(again|confirm(ation)?)\b/, attr: /\b(confirm|verify|repeat|re ?enter) ?e ?mail\b|\be ?mail ?(confirm|again|2)\b/, kinds: ['text'] },
    { key: 'email', label: /\be-?mail( address)?\b/, attr: /\be ?mail\b/, ac: ['email'], type: 'email', not: /confirm|re-?enter|verify|again|repeat|alert|subscribe|newsletter|referr|manager|supervisor|reference|recruiter|emergency|school|personal website|opt/, kinds: ['text'], maxLen: 80 },
    { key: 'phoneCountryCode', label: /\bcountry (phone |dialing |calling )?code\b|\bphone (number )?country\b|\b(dial(l?ing)?|calling) code\b|country\/region phone code|^country code$/, attr: /\b(country ?(phone )?code|phone ?country|dial ?code|calling ?code)\b/, ac: ['tel-country-code'], kinds: ['text', 'select', 'combobox'] },
    { key: 'phoneExtension', label: /\bext(ension)?\b\.?$|\bphone extension\b/, attr: /\bext(ension)?\b/, kinds: ['text'], maxLen: 40 },
    { key: 'phoneType', label: /\b(phone|device|number) type\b|\btype of (phone|device|number)\b/, attr: /\b(phone ?type|device ?type)\b/, kinds: ['select', 'radio', 'combobox'] },
    { key: 'phone', label: /\b(phone|mobile|cell(ular)?|telephone|contact number|tel)\b/, attr: /\b(phone|mobile|cell|telephone|tel)\b/, ac: ['tel', 'tel-national', 'mobile'], type: 'tel', not: /\btype\b|country|code\b|\bext|emergency|reference|manager|supervisor|opt|text message|\bsms\b|consent|may we|can we|permission|agree|prefer(red)? (method|contact)/, kinds: ['text'], maxLen: 80 },

    // --- address
    { key: 'addressLine2', label: /\baddress( line)? ?2\b|\bapt\b|\bapartment\b|\bsuite\b|\bunit\b|\baddress line two\b/, attr: /\b(address ?(line)? ?2|addr2|apt|suite|unit)\b/, ac: ['address-line2'], kinds: ['text'], maxLen: 60 },
    { key: 'addressLine1', label: /\b(street( address)?|address( line)? ?1|mailing address|home address|residential address|current address|^address$|address line one)\b/, attr: /\b(address ?(line)? ?1|addr1|street|address)\b/, ac: ['address-line1', 'street-address'], not: /e-?mail|\b2\b|city|state|zip|postal|country|web|url|\bip\b|billing|company|employer|school/, kinds: ['text', 'textarea', 'combobox'], maxLen: 60 },
    { key: 'postalCode', label: /\bzip( ?code)?\b|\bpostal( ?code)?\b|\bpost ?code\b|\bpin ?code\b/, attr: /\b(zip|postal|post ?code|postcode)\b/, ac: ['postal-code'], kinds: ['text'], maxLen: 60 },
    { key: 'location', label: /^(current |your |home )?location$|\bcurrent (city|location)\b|where (are you|do you) (currently )?(located|based|live|reside)|^city,? state$|\bcity (and|&|\/) state\b|\bcity,? state,? (country|zip)\b|^location \(city\)|\bwhere do you live\b|^(current )?residence$/, attr: /\b(current ?location|candidate ?location|location)\b/, not: /prefer|desired|willing|relocat|office|work location|job location|position location|interview|travel|hub|remote|which of|select the/, kinds: ['text', 'combobox'], maxLen: 80, section: '!repeat' },
    { key: 'city', label: /\bcity\b|\btown\b|\bmunicipality\b|\blocality\b/, attr: /\b(city|town|locality)\b/, ac: ['address-level2'], not: /state|zip|country|birth|citizen|ethnic|university|college/, kinds: ['text', 'combobox', 'select'], maxLen: 60, section: '!repeat' },
    { key: 'county', label: /\bcounty\b/, attr: /\bcounty\b/, not: /country/, kinds: ['text', 'select', 'combobox'], maxLen: 40 },
    { key: 'state', label: /\bstate\b|\bprovince\b|\bregion\b|\bprefecture\b|\bterritory\b/, attr: /\b(state|province|region|country subdivision|subdivision)\b/, ac: ['address-level1'], not: /united states|statement|estate|marital|status|\bstate (your|the|why|how)\b|please state|city,? state|\bstated\b|country|licen[cs]e|what state|salary/, kinds: ['text', 'select', 'combobox'], maxLen: 60, section: '!repeat' },
    { key: 'country', label: /\bcountry\b|\bcountry\/region\b|\bnation\b/, attr: /\bcountry\b/, ac: ['country', 'country-name'], not: /\bcode\b|phone|citizen|birth|county|origin|authori[sz]|other countries|countries|visa|nationality|work in/, kinds: ['text', 'select', 'combobox'], maxLen: 60, section: '!repeat' },

    // --- links
    { key: 'linkedin', label: /linked ?in/, attr: /linked ?in/, not: /how did you hear|source|where did you/, kinds: ['text'] },
    { key: 'github', label: /\bgit ?hub\b/, attr: /\bgit ?hub\b/, kinds: ['text'] },
    { key: 'twitter', label: /\btwitter\b|\bx\.com\b|^x( \(twitter\))?( profile| url| handle)?$/, attr: /\btwitter\b/, kinds: ['text'] },
    { key: 'otherUrl', label: /\bother (url|link|website|profile)s?\b/, attr: /\bother ?(url|link|website)\b/, kinds: ['text'] },
    { key: 'portfolio', label: /\bportfolio\b|\bpersonal (web)?site\b|\bwebsite\b|\bblog\b|\bweb ?page\b|\burl\b|\bhomepage\b|\blinks?\b$/, attr: /\b(portfolio|website|personal ?site|url|homepage|blog)\b/, ac: ['url'], type: 'url', not: /linked ?in|git ?hub|twitter|company('s)? (web)?site|how did you hear|source|found|job board|glassdoor|indeed|other/, kinds: ['text'], maxLen: 80 },

    // --- documents
    { key: 'coverLetterFile', label: /\bcover ?letter\b|\bmotivation(al)? letter\b/, attr: /\bcover ?letter\b/, kinds: ['file'] },
    { key: 'resume', label: /\bresume\b|\br\u00e9sum\u00e9\b|\bcv\b|\bcurriculum vitae\b/, attr: /\b(resume|cv|curriculum)\b/, not: /cover/, kinds: ['file'] },

    // --- current job / preferences
    { key: 'currentCompany', label: /\b(current|present|most recent|latest|last)\s*(company|employer|organi[sz]ation)\b|^(company|employer|organi[sz]ation)( name)?$|^org$/, attr: /\b(current ?company|current ?employer|org|company|employer)\b/, not: /previous|former|past|referr|manager|school|website|size|industry|why|reason/, kinds: ['text', 'combobox'], maxLen: 60, section: '!repeat' },
    { key: 'currentTitle', label: /\b(current|present|most recent|latest)\s*(job\s*)?(title|position|role|job)\b|^(job )?title$|^headline$|^professional title$/, attr: /\b(current ?(job ?)?title|headline|job ?title)\b/, not: /desired|applying|you are applying|job you|company|employer|responsibilit|describe/, kinds: ['text', 'combobox'], maxLen: 60, section: '!repeat' },
    { key: 'yearsExperience', label: /\byears? of (total |overall |professional |relevant |related |work |industry |full.?time )?(work )?experience\b|\bhow many years\b.*\bexperience\b|\btotal (work )?experience\b|\bexperience \(years\)|\byears experience\b/, attr: /\byears ?(of )?experience\b/, not: /\b(with|using|in (a|an|the)? ?[a-z0-9#+.]+ (language|framework|tool|role|environment|setting|industry)|managing|leading|as an?|writing|building|developing|working (with|in|on)|programming|sql|python|java|react|aws|sales|management|leadership)\b/, kinds: ['text', 'select', 'radio', 'combobox'], maxLen: 120 },
    { key: 'salaryCurrency', label: /\bcurrency\b/, attr: /\bcurrency\b/, kinds: ['select', 'combobox', 'text'], maxLen: 40 },
    { key: 'desiredSalary', label: /\b(desired|expected|target|requested|minimum|base)\s*(annual\s*)?(salary|compensation|pay|wage|rate)\b|\bsalary (expectation|requirement)s?\b|\bcompensation (expectation|requirement)s?\b|\bpay (expectation|requirement)s?\b|\bwhat are your (salary|compensation|pay) (expectation|requirement)s?\b|^salary$|\bexpected (ctc|salary)\b|\bdesired pay\b|\bhourly rate\b/, attr: /\b(desired ?salary|salary ?expectation|expected ?salary|desired ?pay|salary)\b/, not: /current|history|previous|currency|posted|transparen|disclos|\blaw\b|range for this|comfortable with|is (the|this) .* (acceptable|ok)|aware/, kinds: ['text', 'select', 'combobox', 'radio'], maxLen: 120 },
    { key: 'noticePeriod', label: /\bnotice period\b|\bhow much notice\b|\bnotice (do you need|required|to your (current )?employer)\b/, attr: /\bnotice ?period\b/, kinds: ['text', 'select', 'combobox', 'radio'], maxLen: 120 },
    { key: 'availableStartDate', label: /\b(earliest|available|possible|desired|anticipated|expected|preferred|potential)\s*(start|starting)\s*date\b|\bwhen (can|could|would|will) you (start|begin|join)\b|\bdate (available|of availability)\b|\bavailab(le|ility) (to start|date|start)\b|^start date$|\bhow soon can you start\b/, attr: /\b(start ?date|available ?date|availability ?date|date ?available)\b/, not: /internship|program/, kinds: ['text', 'date', 'select', 'combobox', 'radio'], maxLen: 120, section: '!repeat' },
    { key: 'workPreference', label: /\b(remote|hybrid|on.?site|in.?office|work(ing)? (arrangement|model|location|environment|style|setup))\b.*\b(prefer|preference)\b|\bprefer(red)? (work(ing)? )?(arrangement|model|location|setup|environment)\b|\bwork(place)? (type|preference)\b/, kinds: ['select', 'radio', 'combobox', 'checkboxGroup'], options: (opts) => opts.filter((o) => GAF.options.CATEGORY.workPreference(o)).length >= 2, maxLen: 160 },

    // --- eligibility (yes/no mostly)
    { key: 'authorizedNoSponsorship', label: /\b(authori[sz]ed|eligible|legally (able|permitted|allowed)|right) to work\b.*\bwithout\b.*\bsponsor/, kinds: CHOICE.concat(['checkbox']), maxLen: 400 },
    { key: 'requireSponsorship', label: /\bsponsor(ship|ed)?\b|\bvisa (status|support|transfer|assistance)\b|\bh-?1b\b|\bimmigration (support|filing|assistance|sponsorship)\b|\bwork (visa|permit) (support|sponsorship)\b|\brequire (a )?visa\b/, not: /i understand|acknowledge|what (type|kind) of visa|visa type|which visa|current visa|visa expir|visa status\??$/, kinds: CHOICE.concat(['checkbox', 'text']), maxLen: 400 },
    { key: 'authorizedToWork', label: /\b(legally )?(authori[sz]ed|eligible|permitted|entitled|able|allowed)\s+(to\s+)?(work|be employed|for employment)\b|\bwork authori[sz]ation\b|\bemployment (eligibility|authori[sz]ation)\b|\bright to work\b|\blegal(ly)? (right|eligib)/, not: /sponsor|what is your|type of|which|describe|explain|status\??$/, kinds: CHOICE.concat(['checkbox']), maxLen: 400 },
    { key: 'isCitizen', label: /\bare you (a |an )?(u\.?s\.?|united states|us|american) citizen\b|\b(u\.?s\.?|united states) citizen(ship)?\?$/, kinds: CHOICE, maxLen: 200 },
    { key: 'citizenship', label: /\bcitizenship\b|\bcountry of citizenship\b|\bnationality\b|\bcitizen of\b/, not: /dual|are you|do you|proof/, kinds: ['text', 'select', 'combobox'], maxLen: 120 },
    { key: 'over18', label: /\b(18|eighteen)\s*(years|yrs)?\b.*\b(age|old|older)\b|\bat least (18|eighteen)\b|\blegal (working )?age\b|\bover (the age of )?(18|eighteen)\b|\bage of (18|majority)\b|\bminimum age\b/, kinds: CHOICE.concat(['checkbox']), maxLen: 300 },
    { key: 'willingToRelocate', label: /\brelocat/, not: /assistance|package|benefit|expense|reimburs|cost|bonus|stipend/, kinds: CHOICE.concat(['checkbox']), maxLen: 300 },
    { key: 'willingToTravel', label: /\b(willing(ness)?|able|comfortable|open) (to )?(with )?travel\b|\btravel (up to|requirement|required)\b|\b\d+% travel\b/, not: /expense|reimburs|time|how much|what percent/, kinds: CHOICE.concat(['checkbox']), maxLen: 300 },
    { key: 'previouslyEmployed', label: /\b(previously|ever|formerly|before|past)\b.*\b(employ(ed|ee)|work(ed)?)\b.*\b(for|at|by|with)\b|\b(current|former|previous|ex)[\s-]*(employee|worker|contractor|intern)\b|\bworked (here|for us|at this company) before\b|\bhave you (ever )?(been )?(employed|worked) (by|for|at|with)\b|\bare you (a |currently )?(an )?(current )?employee of\b|\brehire\b|\bcandidate is previous worker\b/, attr: /\b(previous ?worker|former ?employee|previously ?employed|candidate ?is ?previous ?worker)\b/, not: /\breferr|relative|family|how long|when|dates?\b|manager|reason|position|explain|name of/, kinds: CHOICE.concat(['checkbox']), maxLen: 300 },
    { key: 'relativesAtCompany', label: /\b(relative|family member|related to|relationship with|spouse|domestic partner)\b.*\b(employ|work|company|currently)\b|\bknow anyone (who works|at|currently)\b|\bfriends or (family|relatives)\b/, not: /name|explain|describe/, kinds: CHOICE.concat(['checkbox']), maxLen: 300 },
    { key: 'hasReferral', label: /\bwere you referred\b|\breferred by (a|an) (current )?(employee|team member|friend)\b|\bemployee referral\?$|\bdo you have a referral\b/, kinds: CHOICE.concat(['checkbox']), maxLen: 200 },
    { key: 'referrerName', label: /\b(referr(er|ing|al)('s)?|referred by|who referred you|name of (the )?(employee|person|individual) who referred)\b.*\b(name|by|who)\b|^referr(er|al) name$|^referred by$|\bemployee referral name\b/, attr: /\breferr(er|al) ?name\b|\breferred ?by\b/, not: /source|how did|\?$/, kinds: ['text'], maxLen: 120 },
    { key: 'howDidYouHear', label: /\bhow did you (first )?(hear|find|learn|come across|discover|get to know)\b|\bwhere did you (hear|find|see|learn|discover)\b|\b(referral|application|lead|candidate|job|recruiting) source\b|^source$|\bhow were you referred\b|\bhow did this (job|position|opportunity) come to your attention\b/, attr: /\b(source|how ?did ?you ?hear|referral ?source|hear ?about)\b/, not: /open source|data source|source code|funding|power source/, kinds: ['text', 'select', 'radio', 'combobox', 'checkboxGroup'], maxLen: 200 },
    { key: 'driversLicense', label: /\bdriver'?s?\s*licen[cs]e\b|\bvalid licen[cs]e\b/, not: /number|state|expir|class|issu/, kinds: CHOICE.concat(['checkbox']), maxLen: 250 },
    { key: 'backgroundCheck', label: /\bbackground (check|screen|investigation)\b|\bdrug (test|screen)(ing)?\b/, not: /authori[sz]e|consent|i (agree|acknowledge|understand)|disclosure/, kinds: CHOICE, maxLen: 300 },
    { key: 'securityClearance', label: /\bsecurity clearance\b|\bclearance level\b|\bactive clearance\b|\b(ts\/sci|top secret) clearance\b/, not: /obtain|eligible to|willing|able to/, kinds: ['text', 'select', 'combobox', 'radio'], maxLen: 250 },
    { key: 'nonCompete', label: /\bnon[\s-]?compete\b|\bnon[\s-]?solicit/, not: /explain|describe/, kinds: CHOICE, maxLen: 300 },
    { key: 'smsConsent', label: /\b(text messages?|sms|texting)\b/, kinds: ['select', 'radio', 'combobox'], options: yesNoOptions, maxLen: 300 },

    // --- EEO / self identification
    { key: 'transgender', label: /\btransgender\b/, kinds: CHOICE, maxLen: 250 },
    { key: 'sexualOrientation', label: /\bsexual orientation\b/, kinds: CHOICE.concat(['checkboxGroup']), maxLen: 250 },
    { key: 'gender', label: /\bgender\b|^sex$|\bsex\b(?! offender)/, attr: /\b(gender|sex)\b/, not: /orientation|transgender|pronoun|same as.*assigned/, kinds: CHOICE.concat(['text']), maxLen: 250 },
    { key: 'hispanicLatino', label: /\bhispanic\b|\blatin[oaxe]\b/, kinds: CHOICE, options: yesNoOptions, maxLen: 300 },
    { key: 'race', label: /\brace\b|\bethnicity\b|\bethnic (group|background|origin|identity)\b|\bracial\b/, attr: /\b(race|ethnicity)\b/, not: /\bembrace|\btrace|\bgrace|\bbrace/, kinds: CHOICE.concat(['checkboxGroup']), maxLen: 300 },
    { key: 'veteran', label: /\bveteran\b|\bmilitary (service|status|spouse)\b|\barmed forces\b|\bprotected veteran\b/, attr: /\bveteran\b/, not: /spouse/, kinds: CHOICE.concat(['checkboxGroup']), maxLen: 400 },
    { key: 'disability', label: /\bdisabilit(y|ies)\b|\bdisabled\b|\bhandicap/, attr: /\bdisability\b/, not: /accommodat|reasonable|signature|\bdate\b|\bname\b/, kinds: CHOICE.concat(['checkboxGroup']), maxLen: 400 },

    // --- education (repeatable)
    { key: 'highestEducation', label: /\bhighest (level of )?(education|degree|qualification)\b|\b(education|degree) level\b|\blevel of education\b|\beducation(al)? (attainment|background)\b/, kinds: ['select', 'radio', 'combobox', 'text'], maxLen: 150 },
    { key: 'edu.school', label: /\b(school|university|college|institution|academy)( name)?\b/, attr: /\b(school|university|college|institution)\b/, not: /high school (diploma|graduate)\?|did you|are you|graduat(e|ion) (year|date)|degree|major|field/, kinds: ['text', 'combobox', 'select'], maxLen: 80 },
    { key: 'edu.field', label: /\bfield of study\b|\bmajor\b|\bdiscipline\b|\barea of (study|concentration)\b|\bconcentration\b|\bspeciali[sz]ation\b|\bcourse of study\b|\bprogram of study\b/, attr: /\b(field ?of ?study|major|discipline)\b/, not: /minor/, kinds: ['text', 'combobox', 'select'], maxLen: 80 },
    { key: 'edu.gpa', label: /\bgpa\b|\bgrade point\b|\boverall result\b|\bcumulative grade\b|\bgrades?\b$/, attr: /\b(gpa|grade ?average)\b/, kinds: ['text', 'select', 'combobox'], maxLen: 80 },
    { key: 'edu.degree', label: /\bdegree\b|\bqualification\b|\bdiploma\b/, attr: /\bdegree\b/, not: /\bdegree of\b|highest|level|do you have|are you|field|major|pursuing|expected/, kinds: ['text', 'select', 'combobox'], maxLen: 80, section: 'edu' },
    { key: 'edu.graduationYear', label: /\bgraduation (year|date)\b|\byear of graduation\b|\b(expected |anticipated )?grad(uation)? (year|date)\b|\bdate graduated\b|\bcompletion (year|date)\b/, kinds: ['text', 'select', 'combobox', 'date'], maxLen: 80 },

    // --- experience (repeatable; only inside an experience section)
    { key: 'exp.current', label: /\bcurrent(ly)? (work|employed|job|role|position|employer)\b|\bi (currently )?work here\b|\bpresent\b|\bstill (employed|work)/, attr: /\bcurrently ?work ?here\b|\bcurrent ?(job|position)\b/, kinds: ['checkbox'], section: 'exp' },
    { key: 'exp.title', label: /\b(job )?title\b|\bposition( title)?\b|\brole\b/, attr: /\b(job ?title|title|position)\b/, not: /description|responsibilit|company|employer|desired|applying/, kinds: ['text', 'combobox'], maxLen: 60, section: 'exp' },
    { key: 'exp.company', label: /\bcompany\b|\bemployer\b|\borgani[sz]ation\b/, attr: /\b(company|employer|organi[sz]ation)\b/, not: /title|description|website|address|phone/, kinds: ['text', 'combobox'], maxLen: 60, section: 'exp' },
    { key: 'exp.location', label: /\blocation\b|\bcity\b/, attr: /\blocation\b/, kinds: ['text', 'combobox'], maxLen: 60, section: 'exp' },
    { key: 'exp.description', label: /\b(role |job |position )?description\b|\bresponsibilit|\bduties\b|\bachievements\b|\bsummary\b/, attr: /\b(description|responsibilities|duties)\b/, kinds: ['text', 'textarea'], maxLen: 80, section: 'exp' },

    // --- dates inside repeatable sections (exp or edu decided by section)
    { key: '$.startMonth', label: /\b(start|from|begin(ning)?)\b.*\bmonth\b|^month$/, attr: /\b(start ?date ?month|from ?month|start ?month|date ?section ?month)\b/, kinds: ['text', 'select', 'combobox'], maxLen: 40, section: 'repeat', dateRole: 'start' },
    { key: '$.startYear', label: /\b(start|from|begin(ning)?)\b.*\byear\b/, attr: /\b(start ?date ?year|from ?year|start ?year)\b/, kinds: ['text', 'select', 'combobox'], maxLen: 40, section: 'repeat' },
    { key: '$.endMonth', label: /\b(end|to|until|finish)\b.*\bmonth\b/, attr: /\b(end ?date ?month|to ?month|end ?month)\b/, kinds: ['text', 'select', 'combobox'], maxLen: 40, section: 'repeat' },
    { key: '$.endYear', label: /\b(end|to|until|finish)\b.*\byear\b/, attr: /\b(end ?date ?year|to ?year|end ?year)\b/, kinds: ['text', 'select', 'combobox'], maxLen: 40, section: 'repeat' },
    { key: '$.startDate', label: /^(start|from|begin|beginning)( date)?$|\bstart date\b|\bdate (started|from)\b|\bfrom date\b/, attr: /\b(start ?date|from ?date|date ?from)\b/, kinds: ['text', 'date', 'combobox'], maxLen: 40, section: 'repeat' },
    { key: '$.endDate', label: /^(end|to|until)( date)?$|\bend date\b|\bdate (ended|to)\b|\bto date\b|\bcompletion date\b/, attr: /\b(end ?date|to ?date|date ?to)\b/, kinds: ['text', 'date', 'combobox'], maxLen: 40, section: 'repeat' },

    // --- misc
    { key: 'languages', label: /\blanguages? (spoken|you speak|proficien)|^languages?$|\bwhat languages\b|\bforeign languages?\b/, attr: /\blanguages?\b/, kinds: ['text', 'combobox', 'checkboxGroup'], maxLen: 80 },
    { key: 'skills', label: /^(key |technical |relevant )?skills?$|\blist (your|of) skills\b|\bskills (and|&) (expertise|technologies)\b/, attr: /\bskills?\b/, kinds: ['text', 'textarea', 'combobox'], maxLen: 60 },
  ];

  // ---------------------------------------------------------------------------------------------

  function sectionKind(field) {
    const s = normalize((field.section || []).slice(0, 2).join(' | '));
    if (!s) return null;
    const first = normalize((field.section || [])[0] || '');
    if (EXP_SECTION.test(first) && !/\beducation\b/.test(first)) return 'exp';
    if (EDU_SECTION.test(first)) return 'edu';
    if (EXP_SECTION.test(s) && !EDU_SECTION.test(s)) return 'exp';
    if (EDU_SECTION.test(s) && !EXP_SECTION.test(s)) return 'edu';
    return null;
  }

  function customRuleMatches(rule, text) {
    const m = String(rule.match || '').trim();
    if (!m || rule.answer == null || rule.answer === '') return false;
    const re = m.match(/^\/(.+)\/([a-z]*)$/i);
    if (re) {
      try { return new RegExp(re[1], re[2].includes('i') ? re[2] : re[2] + 'i').test(text); } catch (_) { return false; }
    }
    return m.split(',').map((w) => normalize(w)).filter(Boolean).every((w) => text.includes(w));
  }

  function textFor(field) {
    return normalize(field.kind === 'radio' || field.kind === 'checkboxGroup' || field.kind === 'ariaRadio' ? (field.question || field.label) : (field.label || field.question));
  }

  /**
   * @param {object} field collected field descriptor (see fields.js)
   * @param {object} ctx { profile, settings }
   */
  function classify(field, ctx) {
    const text = textFor(field);
    const fullText = normalize([field.question, field.label].filter(Boolean).join(' '));
    const attrs = field.attrs || '';
    const kind = field.kind;
    const sec = sectionKind(field);
    const profile = (ctx && ctx.profile) || {};

    if (kind === 'password') return { skip: 'sensitive', reason: 'password' };

    // 0) account credentials (username/login next to a password box) - the user creates their own account
    if (kind === 'text' && (field.autocomplete === 'username' || /^(login|log in|user ?name|user ?id|account (name|id))\b/.test(text))) {
      return { skip: 'sensitive', reason: 'account login - enter it yourself' };
    }

    // 1) sensitive - never touched
    if (SENSITIVE_RE.test(fullText) && !/\bpassport\b.*\b(country|citizenship)\b/.test(fullText)) return { skip: 'sensitive', reason: 'sensitive personal data' };

    // 2) consent / attestation / signatures
    if ((kind === 'checkbox' || kind === 'ariaCheckbox') && CONSENT_CHECK_RE.test(fullText)) {
      return { skip: 'consent', reason: 'agreement / consent \u2014 review and tick it yourself' };
    }
    if ((kind === 'text' || kind === 'date') && SIGNATURE_TEXT_RE.test(text)) {
      return { skip: 'consent', reason: 'signature \u2014 sign it yourself' };
    }

    // 3) user-defined custom answers
    const custom = (profile.customAnswers || []).find((r) => customRuleMatches(r, fullText));
    if (custom && kind !== 'file') return { key: 'custom', custom, score: 100, via: 'custom rule' };

    // 4) essays (free text only)
    const isFreeText = kind === 'textarea' || kind === 'text';
    const essayLike = isFreeText && ESSAY_RE.test(text) && !(sec === 'exp' && /description|responsibilit|duties|summary/.test(text));
    const longQuestion = isFreeText && text.length > 70 && /\?\s*$/.test(text);

    // 5) built-in rules
    let best = null;
    const hasOptions = Array.isArray(field.options) && field.options.length > 0;
    for (const rule of RULES) {
      if (rule.kinds && !rule.kinds.includes(kind)) continue;
      if (rule.section === 'exp' && sec !== 'exp') continue;
      if (rule.section === 'edu' && sec !== 'edu') continue;
      if (rule.section === 'repeat' && !sec) continue;
      if (rule.section === '!repeat' && sec) continue;
      if (rule.not && rule.not.test(text)) continue;
      if (rule.options && hasOptions && !rule.options(field.options)) continue;
      if (rule.options && !hasOptions && CHOICE.includes(kind) && kind !== 'combobox') continue;

      let score = 0; let via = '';
      const labelOk = rule.label && text && text.length <= (rule.maxLen || 500) && rule.label.test(text);
      if (labelOk) { score = 10; via = 'label'; }
      if (rule.ac && field.autocomplete && rule.ac.includes(field.autocomplete)) { score = Math.max(score, 9); via = via || 'autocomplete'; }
      if (!score && rule.type && field.inputType === rule.type && (!text || text.length < 40)) { score = 7; via = 'type'; }
      if (!score && rule.attr && attrs && rule.attr.test(attrs) && (!text || text.length < 60) && !(rule.not && rule.not.test(attrs))) { score = 5; via = 'attr'; }
      if (score && labelOk && rule.attr && rule.attr.test(attrs)) score += 1;
      if (score && (!best || score > best.score)) best = { key: rule.key, score, via, rule };
      if (best && best.score >= 11) break;
    }

    if (best) {
      let key = best.key;
      if (key.startsWith('$.')) key = (sec === 'edu' ? 'edu.' : 'exp.') + key.slice(2);
      // essays win over weak/fuzzy matches (e.g. "Why do you want to relocate?" is not a yes/no)
      if ((essayLike || longQuestion) && isFreeText && !['email', 'phone', 'linkedin', 'github', 'portfolio', 'desiredSalary', 'availableStartDate', 'referrerName', 'yearsExperience'].includes(key) && !(sec === 'exp' && key === 'exp.description')) {
        return { skip: 'essay', reason: 'open-ended question \u2014 answer it yourself' };
      }
      if ((key === 'exp.title' || key === 'exp.company' || key === 'exp.location') && sec !== 'exp') return { skip: 'unknown', reason: 'no matching profile field' };
      return { key, score: best.score, via: best.via };
    }

    if (kind === 'file') {
      // unlabeled upload widgets ("Drop file here / Select file"): decide from the surrounding section text
      const around = normalize((field.section || []).slice(0, 2).join(' ') + ' ' + (field.context || ''));
      if (/cover ?letter/.test(fullText + ' ' + around) && !/resume|cv\b/.test(fullText)) return { key: 'coverLetterFile', score: 4, via: 'section' };
      if (/\b(resume|r\u00e9sum\u00e9|cv|curriculum vitae)\b/.test(fullText + ' ' + around)) return { key: 'resume', score: 4, via: 'section' };
      return { skip: 'unknown', reason: 'unlabeled upload' };
    }
    if (essayLike || (kind === 'textarea') || longQuestion) return { skip: 'essay', reason: 'open-ended question \u2014 answer it yourself' };
    return { skip: 'unknown', reason: 'no matching profile field' };
  }

  GAF.classifier = { classify, RULES, ESSAY_RE, CONSENT_CHECK_RE, SIGNATURE_TEXT_RE, SENSITIVE_RE, EXP_SECTION, EDU_SECTION, sectionKind, customRuleMatches, textFor };
})();
