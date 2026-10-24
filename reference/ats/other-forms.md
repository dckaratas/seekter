# Other and one-off forms

- **HR-ON (same-origin iframe, e.g. EIVA):** if the uploader doesn't register the file ("no files has been uploaded"), choose "I want to type my résumé" and paste text: `pdftotext -layout <CV_PATH> -`. Quill editor: `editor.innerText = cv` + `input` event, then click → `End` → space → `BackSpace`.
- **Alfa Jobs (welovealfa.com):** scroll locks after the country combobox. Drive everything by JS: combobox `.click()`, option from `[role=option]` by text `.click()`, text via setter. Turnstile self-solves.
- **Huzzle:** `form_input`+ref one field at a time; a bulk setter script got blocked ("[Real-World Transactions]"). Draft: "Save this application?" → Save.
- **Siemens (jobs.siemens.com):** session drops silently (`/Error`, `/Login`); verify session after each step; check posting status before retrying.
- **Viterbit:** setter works. City dropdown: click dropdown → click its search box separately (first typing swallowed) → type only the part of the name with no non-ASCII letters → click option. Reject cookies: `s-rall-bn`.
- **select2-style widgets (e.g. In4Matic):** `option.selected=true`+`change` leaves the placeholder visible = not selected → real clicks.
- **BambooHR (content):** read "Minimum Experience" (e.g. Manager/Supervisor) at the end of `get_page_text` — the employer's own seniority tag.
- **BambooHR (form), measured 9 Oct 2026:** "Apply for This Job" opens the form on the same page. Tenants can make Address, City, Province and Postal Code all required, so a profile without a street and postcode cannot finish it. The file input is hidden: give it an id, make it visible, then `file_upload`. Country is a custom select that may already show the right country. A honeypot text field ("Please leave this field blank", far off-screen) sits first in the DOM; never fill it. The visible reCAPTCHA makes every BambooHR form a hand-off anyway.

## JobDiva (staffing-agency portals, `*.jobdiva.com/portal`)

- "Apply Now" offers three paths; **Quick Apply (No Account)** needs no account: first and last name, email, phone with its own country picker, CV, an SMS-consent box (leave unticked) and a data-storage consent for job placement (application consent). Success reads "You've applied! Good luck!". Measured 2 Oct.
- The LinkedIn apply URL carries a session in its query string; if it is cut at `?` the portal answers "Session Expired". Navigate with the full URL.

## Aplitrak / Broadbean (`aplitrak.com/?adid=…`, recruiter postings)

- Name, email, phone, CV and an eligibility radio ("currently eligible to work … in the country to which I am applying"). A JS `.click()` on `submit_btn` does nothing; a coordinate click on "Apply Now" submits and lands on `generic/submit.cgi` with "Thank you for submitting your application". Measured 2 Oct.

## Getro VC job boards (`*.getro.com/companies/<co>/jobs/<id>`)

- "Apply now" opens a modal that requires a LinkedIn URL before it reveals the employer's link, and submitting it makes the profile visible to the fund's portfolio companies. That is a talent-network opt-in the candidate has not given: hand off, or find the employer's own ATS. Measured 2 Oct.

## Mantu careers (`careers.mantu.com/brands/<brand>/jobs/<id>`, Amaris Consulting and the other Mantu brands)

- One-page form under the posting: first name, surname, email, phone (intl-tel-input, detects the country from a `+` number; the "between 0 and 15 digits" line under it is help text, not an error), a required résumé upload (`input[name=resume]`, `file_upload` works) and a required box "I agree to Mantu's Terms and Conditions and the Privacy Policy". That box is a terms acceptance: fill everything else and hand off. Invisible reCAPTCHA v3 badge only. The posting header carries the job's working language ("Permanent Job · Turkish"), which settles a language question the English description leaves open. Cookie banner: "Deny". Measured 10 Oct 2026.

## Microsoft (`apply.careers.microsoft.com`)

- "Apply now" goes to a sign-in page (Microsoft, LinkedIn, Google or Facebook account) before any form. Account wall: hand off. Measured 2 Oct.

## CleverStaff (`cleverstaff.net/i/vacancy-<id>`)

- Apply opens a modal: first name, surname, email, phone, one custom "CV or LinkedIn" field (a textarea plus up to two files), and a required consent to processing "for this and other vacancies". `form_input` fills the text fields.
- ⛔ **The file upload succeeds on the server and is still rejected by the form.** Measured 2 Oct: `file_upload` on the hidden `input[type=file]` posted to `/hr/public/addCvFile` (200, status ok), no file chip appeared, and Apply returned "You should fill all obligatory fields" with "Select file" under the field. The input carries `ng-click="selectFile(custom, $event)"`, which records which field the next upload belongs to; a programmatic upload skips that click, so the callback has no field to attach the file to. Call it first, then upload:
  ```js
  const f=document.querySelector('input[type=file]');const s=angular.element(f).scope();
  const c=s.$parent.custom;const root=s.$parent.$parent.$parent;root.selectFile(c,{target:f});root.$apply();
  ```
  Then `file_upload` on the same ref. An "Added file" toast and a chip under the textarea confirm it; `custom.files` holds the attachment id.
- Confirmation is a modal: "Thanks! The employer has got your application".

## Oracle Cloud HCM candidate sites (`*.fa.*.oraclecloud.com/hcmUI/CandidateExperience/…/apply/email`)

- The first screen asks for an email and says the candidate profile "will be created and kept up to date automatically". That is account creation: hand off. Measured 2 Oct (Marriott).
- After the candidate signs in (email plus the terms box, sometimes a one-time code), the whole application is one long page and Seekter can fill it. Measured 19 Oct:
  - **Upload the CV first.** Text fields take the native setter plus `input`/`change`/`blur`. Radio-style questions and the title are pill buttons; the chosen one gets `cx-select-pill-section--selected`.
  - **Comboboxes** (month, year, country, major, institution, skill) list their options as `.cx-select__list-item` inside the element named by the input's `aria-controls`. `mousedown` plus `click` on the item selects it. Searches that load from the server (institution, skill) can lag a few seconds behind the typed text, so a "no results" read right after typing is not final. When a scripted pick does nothing, a coordinate click on the visible option works.
  - **Institution list:** smaller universities outside the US and EU are often missing; "Other/Not Listed" is an option.
  - **Skill list:** a fixed taxonomy. Common design terms like "Design Systems" may return nothing, while "Figma (Software)", "Prototyping" and "User Experience (UX)" exist.
  - Each Education, Experience and Skill entry has its own Add button, which saves the entry into a list.
  - The page ends with optional job-alert and marketing boxes (leave unticked; **re-read both just before handing over**, because the marketing box was found ticked after a run of scripted skill adds, cause not pinned down) and an **E-Signature full-name field**, which is the candidate's to sign before SUBMIT.

## Google Forms (`forms.gle/…`, `docs.google.com/forms/…`)

- A form with a file upload records the signed-in Google account's email ("The name, email address and photo associated with your Google Account will be recorded when you upload files"). If the browser's Google account is not the profile's application email, that address goes to the employer with the CV. Check the account line at the top of the form before filling; if it is the wrong address, hand off. Measured 2 Oct.

## Airtable forms (`airtable.com/app…/shr…`, used as a careers form by small agencies)

- Plain inputs take real typing through `find` refs; the "Role Applying" select is a combobox whose options are `[role=option]` and take a ref click.
- **The resume field has no file input until "Attach file" is clicked.** The click opens a Filestack picker dialog, and only then do two `input[type=file]` elements exist, both inside the dialog. Expose them in place (style them visible and give them an `aria-label` so `find` can name them), upload to the first, then press the picker's blue **Upload** button. The file name appears under the field only after that button. Measured 21 Oct 2026.
- Success replaces the form with "Thank you! We have received your application." on the same URL.

## iCIMS (`careers-<co>.icims.com/jobs/<id>/…`), filled after the candidate's sign-in

- The form lives in `iframe#icims_content_iframe`, same origin, so `contentDocument` reads and fills every field. `find` and `read_page` do not see inside it, which means `file_upload` gets no ref for the resume input: the candidate attaches the CV. Opening the iframe's own URL (`…/candidate?in_iframe=1`) in a new tab lands on the login page, because the email-code session does not carry over. Measured 21 Oct 2026.
- Country, State/Province and Time Zone are `<select>`s that only load their options through a widget beside them (`a.dropdown-select`): click it, type in its search box, click the option. Plain selects such as phone and address type take the value of the option whose text matches.
- The page creates the account in the same form (Login, Password, Re-enter). Those are the candidate's.

## Taleo (`<co>.taleo.net/careersection/…/jobapply.ftl`), filled after the candidate's sign-in

- Every "Add Work Experience" or "Remove Education" click reloads the whole page, so helpers on `window` vanish. Keep each step one self-contained script: fill the newest block, then click Add. Values already typed survive the reload.
- Phone fields can enforce the US pattern `999-999-9999` even when the country is not the US; a number with its country code fails with "The value does not match the pattern". Enter the national number in that shape.
- The source picker is two-level and may have no LinkedIn entry at all; pick the truthful nearest one and say so in the record.
- Multi-select questions are checkboxes named `…-<n>-qc`, single-choice ones radios named `…-<n>-qr`; matching on the label text and calling `.click()` registers on both. The eSignature step is the candidate's. Measured 21 Oct 2026.

## Dueto (`api.dueto.io/Redirect/<id>` → `employer.dueto.io/position/<n>/<co>`)

First measured 23 Oct 2026. No account. The LinkedIn apply link is a redirect that lands on the posting with the form under it.
- Three steps. Step 1 is only the resume (`input[type=file]`, `file_upload` works); Next parses it and step 2 shows first name, last name, email, phone and LinkedIn already filled from the PDF. Read them back, then Next.
- Step 3 holds the employer's own questions as plain text inputs with ids `positionPage_question-<n>-<m>` and **no `name` attribute**, so select by id. `form_input` by ref sets them; the native setter renders the value too, but use `form_input` so the framework's state follows.
- The required consent box (`#positionPage_isUserPrivacyAgreementAccepted`) reads "I accept the Privacy Policy and the Terms of Service", which bundles the platform's terms of service with the data-processing consent. Accepting terms is the candidate's, so the form becomes a hand-off: fill everything, leave the box and Submit Application to them.

## Recruitcrafts (`app.recruitcrafts.com/job-detail/<id>`)

- A small Turkish agency ATS; LinkedIn's offsite apply URL points straight at the job page. The page's own "Easy Apply" button (no relation to LinkedIn's) opens `?tab=upload_cv` on the same page: first name, last name, phone (`+90` picker, national number, rendered spaced), email, a dropzone with a hidden `input[type=file]` (expose it and upload through `file_upload`), and one required data-processing consent for the application. Step 2 is "Application Questions". No account is asked for up front. Measured 22 Oct 2026.
- **The email is checked only on Continue.** If the address already has a Recruitcrafts account (the candidate applied to another posting of the same agency before), Continue answers "This email is already registered in the system. Please log in and apply again." and the questions never open. That is a sign-in wall: hand off, and tell the candidate which PDF to upload after signing in. Check the tracker for earlier postings from the same employer on this ATS before building a tailored CV, because the hand-off is likely.
- The ref click on "Easy Apply" did nothing; a coordinate click opened the form.
