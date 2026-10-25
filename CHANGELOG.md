# Changelog

The version is the git tag; there is no version file. Each release is also on
[the releases page](https://github.com/selfishprimate/seekter/releases) with the
same text.

## v0.13.0 — 25 October 2026

Two new form systems, a Windows fix, and the workarounds that broke forms for
the person taking them over. Most of the Turkish board notes come from
[@dckaratas](https://github.com/dckaratas)'s runs. **Update if you run Seekter
from Windows PowerShell 5.1:** every tracker write was refused there.

### On Windows PowerShell 5.1, the tracker refused every write

`Set-Content -Encoding utf8` in Windows PowerShell 5.1 writes a UTF-8
byte-order mark, and `JSON.parse` rejects it. Since v0.12.0 the run writes
every `add` and `move` through `--json FILE`, so on that shell each one failed
with "is not valid JSON" and nothing was logged. `--json` now strips the mark.
A test covers it.

### Workarounds that left forms broken for the person taking over

Three places where the way Seekter reached a hidden field made the form fail
later, silently:

- **Manatal** (careers-page.com): the reference said to give the hidden resume
  input an id so it could be found. The page looks the file up by its own id,
  on change and at submit, so with the id renamed Apply did nothing at all: no
  request, no error. The candidate's own click on Browse also opened no picker.
  Keep the id; undo the inline styles after the upload.
- **Dice**: the Easy Apply wizard attaches whatever resume sits on the Dice
  profile, a month old in the case measured. Replacing it means capturing the
  file input instead of letting it open the system file dialog, and that patch
  has to come off right after the upload: left in place, it made the
  candidate's own upload buttons dead in that tab.
- **Workday**: the Websites rows ignore values set from script (Review shows
  "No Response"), and every URL typed in a session stays in Workday's state
  after its row is deleted, so going back to add one more fails with "You
  can't add duplicate website URLs" on every row. Enter the full list once.

### New form systems

- **Dueto** (`api.dueto.io` redirects from LinkedIn): three steps, no account.
  Its one required consent accepts the platform's terms of service together
  with the data-processing consent, so the form ends as a hand-off.
- **Talentics** (`<co>.talentics.app`): no account, autofills from the resume,
  and returns the parsed work history with every month as January. Correct the
  dates before submitting; that list is what the recruiter reads.

### Turkish boards

- **Kariyer.net** replies arrive only on the site, at `/tum-basvurular`, never
  by mail, so an inbox sweep alone makes every application there look
  unanswered. A mandatory question can have no truthful option (a university
  year on a senior posting): hand off.
- **Recruitcrafts** checks the email only on Continue, after the form is built;
  an address that already has an account turns it into a sign-in hand-off.
- **Peoplise**'s first step differs per tenant; read each consent label before
  deciding on a hand-off.
- freehire's `tr.whatjobs.com` links no longer resolve at all; those records
  are leads only.

### Smaller

- LinkedIn read mode: the token has to be read again after every navigation.
  A 403 right after opening the notification feed is that, not a stop signal.
- Indeed's home market came back empty a twelfth time; Dice's third measured
  pass found eleven postings closed by explicit US-only lines.
- Releasing is written down for maintainers in CONTRIBUTING.md, and npm stays
  out of the `/seekter-git` skill.

### Upgrading

Nothing to migrate. Your `profile/`, `applications/` and `runs/` are
git-ignored and untouched.

## v0.12.0 — 22 October 2026

A security fix, an npm package, and four holes found by reading Seekter against
career-ops, a larger job-search kit for AI coding CLIs. **Update if you run
v0.11.0 or earlier:** the first item can run a command on your machine.

### Text from a posting could run as a shell command

The run logged each application by typing the posting's company, its role
and your free-text answers into `seekter.mjs add --company "…" --role "…"
--answers "…"`. Inside double quotes, a role named `$(…)` or holding a
backtick runs as a command, and a heredoc is no fix, because a line equal to
its delimiter closes it early. A posting written to do this was never seen,
but nothing stopped one.

Every `seekter.mjs` command now also takes `--json FILE`: the arguments as one
JSON object, which the agent writes with its file tool. The run, log and
interview skills pass text from a page or a mail only that way, and the live
check reads its URLs from a file. Tested with a role holding `$(touch …)`: it
was stored verbatim and nothing ran.

### New: `npx seekter init`

The kit is on npm as `seekter`. `npx seekter init [folder]` downloads the
newest release from GitHub and unpacks it into a new or empty folder, checks
that it is a Seekter release with nothing but placeholders under `profile/`,
`applications/` and `runs/`, and prints the responsibilities from
DISCLAIMER.md and the next steps. It never writes into a folder that holds
something, and removes what it unpacked if anything fails. The package has
no dependencies and no install scripts; the repository still has no
`package.json` at its root. Cloning and seekter.zip work as before.

### The answer check let a made-up money figure through

`claims.mjs` (v0.11.0) skipped every amount with a currency as if it were a
salary answer, and read "$2M" as a bare 2, which is too short to check. So
"grew revenue from $2M to $5M" passed. Now only a sentence or form field that
names salary, pay, a rate or a band is skipped, and `2M`, `30k` and
`1.5 million` are numbers. The resume validator shares the change.

### A LinkedIn link with a title in it slipped past dedup

Share links and job-alert mails write `/jobs/view/<title>-<id>`. That form got
a path key instead of `linkedin:<id>`, so the same posting reached once by id
and once by a share link looked like two jobs. Stored keys do not change.

### The live check called some open postings closed

Lever answers 404 on its public API for a confidential posting that is still
open, and the check took the 404 as closed. A 404 now asks the hosted job
page. SmartRecruiters' `active: false`, Workday's withdrawn-posting answer
(403 with `S22`) and Workable's job state are read as well.

### `stats --by` counted applications still waiting as unanswered

Every sent application was in the denominator, including those sent days
ago, and a group of one got a percentage. Rates are now over decided
applications (a reply, or closed); the rest are "in flight" in their own
column; a group with fewer than five decided shows counts only (`--floor`
changes it); and a closing line names the highest and lowest group. On one
tracker, 190 of 561 sent applications were in flight on the day.

### Smaller

- The README and the v0.9.0 notes pointed at a resume editor on seekter.dev
  that only invited accounts can open. The links are gone.
- The npm page shows this README (`node npm/sync-readme.mjs` before a publish),
  with its links and images made absolute.
- Test values that were one candidate's real salary figures and a real
  posting id are made-up ones now.

### Upgrading

Nothing to migrate. Your `profile/`, `applications/` and `runs/` are
git-ignored and untouched, and no stored dedup key changes. If you run your
own scripts against `seekter.mjs`, prefer `--json` for any value that came
from a page. `stats --by` prints one more column.

## v0.11.0 — 22 October 2026

The resume has been held to your profile since v0.9.0; now the texts forms
receive are too. And interview prep, which until now was done by hand in the
chat, is a command.

### A banned phrase could reach a form, and nothing would say so

Cover letters and free-text answers had rules (numbers only from the fact
bank, the profile's banned phrases, no sentence sent twice) and a grep, but no
check. Run over the 149 records with stored answers on 22 Oct: no invented
number had gone out, but banned phrases had, in five applications.

`node scripts/claims.mjs <file> --posting <file> --url <apply url>` now checks
a text before it goes into a field, and prints one line per problem:

- `number`: a number that is in neither your profile's facts nor the posting.
- `voice`: one of your banned phrases, or a long dash.
- `repeat`: a sentence of eight words or more already sent to another company,
  read from the records' "Answers submitted" sections. Your profile's own
  standard answers are meant to repeat and pass.

Dates, years, single digits, links and salary answers are not claims: a salary
is worked out from your band table, which has its own rule. The run skill
writes each answer to a file in `runs/` and checks it before filling the field.
The command exits 1 when anything is found.

### The resume check passed numbers that only appeared in your search settings

`resume.mjs validate` looked a number up anywhere in `profile/profile.md` as
text. A profile is full of numbers that are not claims (search ids, dates,
counts of rows), so a short number was almost always somewhere in it: on one
real profile, a made-up "12" and "40%" both passed. Numbers are now matched
whole, and only in the sections that state facts: identity, standard answers,
salary bands and the fact bank. Files those sections name by path
(`profile/interviews/README.md`, for example) count as facts too, and so does
the master resume. On the resume it was measured on, the result did not
change.

### New: `/seekter-interview`

Prepares one stage at one company: a screening, a hiring-manager round, a
portfolio review, a design or take-home test, an async video, or a final round.

It reads:
- the tracker record and what your application said: salary, location and
  sponsorship answers, the resume type, the submitted answers;
- the posting, after a live check;
- the company's own pages;
- your story bank and earlier preps for the same company.

It writes `profile/interviews/<date>-<company>-<stage>.md` in a fixed order:
- what to know about the company;
- one answer per ask of the role;
- "tell me about yourself";
- likely questions;
- what only you can decide before the call;
- questions to ask back;
- practical checks;
- an empty "How it went" for your notes afterwards.

The rules come from writing these by hand:
- **The answer is how you work, the story is the proof.** Every answer opens
  with your approach, then one story from your story bank.
- **No new stories.** A story is told in your framing, with no detail or
  number it does not have, and your corrections to a story beat the fact bank.
- **The prep never contradicts the application.** A salary you named in the
  form is where it starts; a changed view becomes a decision for you, not an
  answer.
- It never answers the invitation, picks a slot or messages anyone.

The prep is checked with `claims.mjs --no-repeat`, since it is not sent
anywhere. `/seekter-log` offers the command when you report an invitation.

### Upgrading

Nothing to migrate. Your `profile/`, `applications/` and `runs/` are git-ignored
and untouched. To get the most from `/seekter-interview`, keep your stories in
their own file and name it in your profile's fact bank by path, as
`templates/profile.md` now shows. Without one, the fact bank's story list is
used.

## v0.10.0 — 22 October 2026

The fit score has a scale and is given before the form, the report can say
which applications get answers, the employer watchlist reads nine application
systems instead of four, and two ways of wasting a filled form are closed: a
posting already tracked under a shortened URL, and a posting that is no longer
open.

### The fit score was a number with no meaning

Every record had a `fit` field, but nothing said what a 4 was, and it was
written after the form, when it could no longer change anything. It still
predicted replies. On one tracker of 561 sent applications (22 Oct), postings
scored 4 or 5 got a reply 34.5% of the time against 19.5% for 2 or 3, and every
interview with a score had a 4 or a 5, while 208 records had no score or one off
the scale.

So it now has a rubric, in the run skill: 5 when every requirement is met, 4
when the core ones are, 3 with one core requirement missing or the level a step
off, 2 with two or more missing, 1 when almost nothing matches. It is read from
the profile's target roles and fact bank, given after reading the posting and
before the form, and never moved by location or pay. It orders the queue inside
each priority tier and removes nothing. `add --fit` refuses anything outside 1
to 5.

### New: `stats --by`, which applications get answers

`node scripts/seekter.mjs stats --by <field>` breaks sent applications, replies
and interviews down by any front-matter field (source, form system, apply path,
location fit, fit, resume type) or by `title`, `seniority` and `month`, which it
derives from the record. Two fields can be crossed (`--by ats,location_fit`) and
`--min N` hides groups too small to read. An interview counts when a record
reached interviewing or offer at any point, so a later rejection does not erase
it. `/seekter-report` uses it for its breakdowns.

### New: five more application systems on the employer watchlist

The watchlist could only read Greenhouse, Ashby, Lever and Workable, so a
company on any other system could not be watched at all. It now also reads
SmartRecruiters, Recruitee, Personio, Teamtailor and Workday:

| `ats` | `slug` |
|---|---|
| `smartrecruiters` | the company identifier in `jobs.smartrecruiters.com/<slug>` |
| `recruitee` | the subdomain of `<slug>.recruitee.com` |
| `personio` | the subdomain of `<slug>.jobs.personio.de` (or `.com`) |
| `teamtailor` | the career site's host, custom domains included |
| `workday` | `tenant.wdN/site`, from `<tenant>.wdN.myworkdayjobs.com/<site>` |

Workday is searched with the profile's queries, three pages each, rather than
read whole. Measured on real boards on 22 Oct: 4 to 254 postings each. A wrong
slug is reported on Recruitee, Personio and Workday; SmartRecruiters answers an
unknown company with an empty list, so check a new row's first sweep.

Each system is one file in `scripts/providers/`, with the contract in that
folder's README, so adding another is a one-file pull request.

### A posting tracked under one URL came back under a shorter one, and `check` called it new

A record is keyed on the URL it was first applied through. On 22 Oct a
careers-site posting came back through LinkedIn with the end of its path cut
off, `check` answered NEW, and its form was opened a second time. Nothing
warns you when this happens, which is what makes it expensive.

`check`, `check-many` and `add` now take a second look when nothing matches
exactly: on the same host, one path being the other cut short, or both carrying
the same posting id (five or more digits with an optional short prefix, like
`P-100931` or `_261413-1`), is the same posting, and the output says which of
the two it was. Stored keys do not change. Prefixed keys (`linkedin:`, `uuid:`,
`greenhouse:`) stay exact. Across 2,103 records on one tracker the new check
pairs exactly one couple, and that couple is a real duplicate.

### New: `live.mjs`, is the posting still open?

A run used to find out a role was gone only after resolving its apply URL and
opening the form. `node scripts/live.mjs <url>…` asks the posting's own system
and prints OPEN, CLOSED or UNKNOWN for each, and exits 3 when every URL is
closed. It covers the nine watchlist systems; LinkedIn is never called. The run
skill does the check between dedup and the form, and on queue items carried
over from earlier runs. Only CLOSED skips a posting.

It asks for the posting itself, not the company's board: an open Ashby posting
can be missing from its board (unlisted), and the first version of the check
called one closed for that reason. Measured on 40 tracked applications: 8
closed, and the four whose forms were tried no longer opened.

### Smaller traps, each measured on a real application

- **Phenom:** on a second employer's quick-apply flow the tab froze about ten
  seconds after any file was set through the extension, the resume and the
  optional attachments alike. Phenom is now a hand-off from the start.
- **Factorial's own careers site** can answer one Send with "You have already
  applied to this job opening". It is the same submission, not an earlier one.
- **LinkedIn read mode:** a detail loop left running between calls crawls even
  in a visible, focused tab (three details in about three minutes). Awaited
  inside the call it runs at the intended pace.

### Upgrading

Nothing to migrate. Your `profile/`, `applications/` and `runs/` are git-ignored
and untouched, and every stored key reads as before. Fit scores already in the
tracker stay as they are; new ones follow the scale. To watch a company on one
of the new systems, add a row to `employers` in `profile/settings.json` with the
`ats` and `slug` above.

## v0.9.0 — 22 October 2026

The kit runs on Node instead of Python, it keeps your resume as data that it
prints and checks, and the resumes it prints now read correctly in an ATS. Plus
four form systems and two traps learned by applying.

### Python is gone; Node 20 is the one requirement

Every script is ported: `scripts/seekter.mjs`, `freehire_sweep.mjs`,
`employer_sweep.mjs` and `import_csv.mjs`, with no packages to install. They use
Node's own `fetch`, so `curl` is no longer needed either. Nothing about your
data changes, and that was measured before the Python went:
- 2,447 real job URLs keyed identically.
- 5,064 lines of command output identical.
- A 20-step sequence of adds and moves left identical trees.
- Live sweeps and the CSV import matched byte for byte.

The tests run with `node --test tests/seekter.test.mjs`, and CI runs them on
Node 20 and 22, on Ubuntu and Windows.

### New: a resume kept as data, one per kind of role

`scripts/resume.mjs` keeps one master resume in
`profile/resume/json/resume.json`:
- your facts;
- a pool of bullets, each tagged and each with an optional one-line `short`
  version;
- the resume types you apply with: product designer, design system designer,
  and so on.

Each type picks its bullets, projects and skills from the pool. It is printed
by the Chrome already on your machine into `profile/resume/`.

- **Two pages is the ceiling**, checked on A4 and US Letter
  (`validate --pages`). A type can say less about older work instead of cutting
  it: tiers of fewer bullets for older jobs, one closing line for the earliest
  ones, the short versions, and a compact layout.
- **`validate` holds the resume to your profile.** Every number has to be in
  your facts. Dates and titles have to match your work history. Your banned
  phrases are flagged.
- **New text is a draft until you approve it.** A PDF that would print a draft
  is refused, unless you ask for a review copy, which goes to
  `profile/resume/drafts/` and never to where forms upload from.
- **A run reprints a resume that is older than its data** before using it.
- **The tracker records which type went with each application**
  (`add --resume <type>`), so outcomes can be read per type later.

Without a `resume.json`, nothing changes: the PDF in `profile/documents/` is
uploaded as before.

### Bold text in a printed resume lost its spaces

The resume printed in Google Fonts' Inter, a variable font. Chrome embeds it as
Type 3, and text extraction then drops the spaces in bold and semibold text: a
parser read "LeadProductDesigner" and the headline as one run of words.
Regular text kept its spaces, which is why it went unnoticed. Measured 21 Oct.

Inter now ships with the kit as static fonts (SIL Open Font License), so
printing also needs no network. `validate` and every print check the file
itself: Type 3 fonts, no text layer, or over Greenhouse's 2.5 MB parsing limit.

A real parse on a Lever form (uploaded, read, not submitted) then filled name,
email, phone, location, company, LinkedIn and GitHub correctly. It never fills
the portfolio field, whatever the resume says; the note is in
`reference/ats/lever.md`.

### New: Airtable, iCIMS and Taleo, and Personio's own site

- **Airtable forms:** the resume input only exists inside the Filestack picker
  that "Attach file" opens.
- **iCIMS:** the form sits in an iframe that a script can fill but the upload
  tool cannot reach, so the resume is yours to attach. The email-code session
  does not carry over to the iframe opened on its own.
- **Taleo:** every Add or Remove reloads the page. Phone fields can force a US
  pattern on a non-US number, and the source picker may have no LinkedIn entry.
- **Personio's own careers site** is an Ashby-backed form that gives every input
  a new `id` after the resume upload. Address fields by `name`.

### Smaller traps, each measured on a real application

- **Ashby:** the space-then-BackSpace commit deletes the last digit of a
  `Number` field. A phone number went out one digit short and the first submit
  silently did nothing. Retype after `cmd+a` instead.
- **Outlook webmail:** typing while the search box is not focused fires
  keyboard shortcuts, and one opened a blank compose window (21 Oct). The inbox
  list is virtualized, so even a quick re-check has to scroll: one read only
  the top rows and missed a rejection just below them.

### Upgrading

1. Install Node.js 20 or newer (`node --version`). Python and `curl` are no
   longer used, and you can leave them installed.
2. If you run the scripts by hand, the commands change from
   `python3 scripts/<name>.py` to `node scripts/<name>.mjs`. The skills already
   call the new ones.
3. Your `profile/`, `applications/` and `runs/` are git-ignored and untouched,
   and they read exactly as before.
4. To keep your resume as data, start from
   `templates/resume/resume.example.json`. The README's resume section walks
   through it.

## v0.8.0 — 19 October 2026

LinkedIn rows that can be told to run every time, a form system that used to
end at a hand-off and is now filled, and five traps found by applying.

### LinkedIn read mode spent most days on rows that yield nothing

With about ten searches a run and a long list of rows, pure rotation reached
the rows that produce applications only every few days. Measured 13 Oct: one
run on the US, Canada and New Zealand rows read 51 remote postings in detail,
and nearly every one was scoped to that country alone, while the Worldwide and
EEA rows had produced the applications of the days before. A row can now
carry `"every_run": true`, which runs it first every time, or
`"alert_only": true`, which keeps it as an email alert and skips it in read
mode. With eight `every_run` rows and 11 single-country rows moved to alerts,
a full cycle went from about 14 days to two or three. `templates/settings.json`
documents both keys.

### New: Oracle Cloud HCM, filled after the candidate signs in

Oracle's candidate sites (`*.fa.*.oraclecloud.com/hcmUI/CandidateExperience/...`)
open on an email screen that creates a profile, so until now they ended as a
hand-off. Once the candidate signs in themselves, the rest is one long page
that Seekter fills: pill-button radios, comboboxes whose options sit under the
input's `aria-controls`, server-side lists that lag the typed text, an
institution list with "Other/Not Listed", and a skill taxonomy that has
"Figma (Software)" but no "Design Systems". The E-Signature stays the
candidate's. Measured 19 Oct, one application submitted. Re-read the optional
marketing box before handing over: it was found ticked after a run of scripted
skill adds, and the cause is not pinned down.

### Workday's citizenship question looked like it had no row for you

"Citizenship Status for Country of Application" asks for your status in the
**job's** country, not for your nationality. Typing your own country finds
nothing, which reads as a broken list, and on 19 Oct a relocation application
nearly went unsent because of it. Search the job's country and pick its
non-citizen option.

### Smaller traps, each measured on a real application

- **Ashby:** uploading the CV wipes a phone number typed before it and resets
  the Yes/No buttons (13 Oct). Upload first, then the phone, then the buttons.
- **Teamtailor:** with the cookie banner open, neither the phone picker's
  search box nor the phone field takes typing. Decline the cookies first; the
  country can be picked by `data-country-code` without the search box.
- **Himalayas** (via freehire): the page carries a single-country badge that
  freehire's record does not show, and every Apply button leads to a signup
  wall. Read the badge first.
- **LinkedIn read mode:** a detail loop left in a background tab slows to
  about one detail a minute because Chrome throttles hidden timers (14 Oct);
  drive the gap from outside instead. `sessionStorage` belongs to the tab's
  origin, so read the inbox in another tab and keep full apply URLs in the
  records.

### Upgrading

Nothing to migrate. Your `profile/`, `applications/` and `runs/` are
git-ignored and untouched. To use the new row flags, add `"every_run": true`
to the LinkedIn rows that bring you applications and `"alert_only": true` to
the ones you only want as email alerts, in `profile/settings.json`. Rows
without either flag rotate as before.

## v0.7.0 — 12 October 2026

Two new application systems, an open call to the platforms Seekter works
around, and a run of defects found by applying: Workday applications that went
out with an empty experience section, and a test suite that went online on
Windows. Doğan Can Karataş contributed the Windows fix and two form notes
(#49, #50).

### New: Factorial and Bizneo

Both measured 11 Oct 2026, both submitted without an account.

- **Factorial** (`<co>.factorial.com/job_posting/...`): plain named inputs that
  take the native setter, a real phone-prefix select, and the contract, salary
  band and work model in the posting header. The privacy acknowledgement is a
  styled checkbox that a ref click does not tick; a coordinate click does. The
  talent-pool box under it is an opt-in and stays empty.
- **Bizneo** (`opportunities.<co>.<tld>/jobs/...`): City is a remote search
  that stays empty however the country is set, until three letters are typed
  into the dropdown's own search box. Its "autocomplete from CV" button
  overwrites every field already entered, so the CV goes through the plain
  attach input instead.

### Workday applications went out with an empty My Experience step

Work Experience, Education and Skills are optional on Workday, and the CV
carries the same facts, so Seekter left them empty on every Workday
application. In Workday those blocks are what the recruiter reads; the
attachment comes second. They are now filled from the profile's work history
only: title, company and dates for every role, a description only where the
profile has facts. The notes cover the fast way to fill ten blocks (measured
11 Oct, no failures), Skills search that does filter on some tenants, and a
Field of Study list reachable only by setting its scroll position.

### On Windows the sweep tests ran against the real network

The freehire and employer-watchlist tests faked `curl` with a shell script on
`PATH`. Windows runs neither, so both tests called the live APIs and 2 of the
suite's tests failed on a clean `main` (measured 12 Oct, Windows 11, Python
3.13). The sweeps now call `curl` through `SEEKTER_CURL` when it is set, and
the tests use a Python fake that works on every platform. Nothing changes when
the variable is unset.

### Smaller traps, each measured on a real application

- **Indeed:** the scraping line still pointed at `h2 a span`, the selector
  that returns empty titles, while the note below it said not to use it. A
  title filter over empty strings reports zero matches on a full page, which
  looks exactly like an empty market.
- **Lever:** the CV parser fills "Current company" with the last employer on
  the CV even when that job has ended, so a candidate between jobs looks
  employed there. Clear it. The optional marketing box stays unticked, as
  `/seekter-run` already says.
- **Kariyer.net:** the salary field can hold the account's saved figure, and
  typing appends to it. On 11 Oct a value grew by three orders of magnitude and
  still looked valid. Read it first, then select, delete and type.
- **Ashby:** `insertText` followed by `form_input` usually clears "Missing
  entry", but on 12 Oct two fields survived two submits that way. Real typing
  fixed both at once.
- **Outlook:** moving a mail into a folder works only through the row's
  context menu; the ribbon button and drag-and-drop did nothing.

### An open call to job platforms and ATSs

`OPEN-CALL.md` says what we ask of the other side: make looking for work free,
recognise an agent that acts for one consenting person, make postings and
forms readable as data, and report where an application stands. In return, six
promises a candidate's agent keeps, all of which Seekter already does. It ends
with a first draft of `/.well-known/candidate-agents.json` and asks for replies
in Discussions.

### Upgrading

Nothing to migrate. Your `profile/`, `applications/` and `runs/` are
git-ignored and untouched. If you run the tests with your own fake `curl`,
point `SEEKTER_CURL` at it instead of putting it on `PATH`.

## v0.6.0 — 10 October 2026

Doğan Can Karataş's second set of runs in Turkey (#45): a new application
system, two forms that end in a hand-off, and Kariyer.net from a logged-in
account. Plus one thing Lever does on its own.

### New: Peoplise

A Turkish recruiting platform used by banks and large employers
(`live.peoplise.com/<co>/Application/...`). The landing page is already the
first step of the form, and all three legal checkboxes on it are enforced
although none is marked required. On one bank tenant the third one shares the
candidate's data with the parent holding company. That is not the
application's own consent, so Seekter fills the rest and hands the posting
back to you.

### Mantu careers and BambooHR end in a hand-off

- **Mantu careers** (`careers.mantu.com`, Amaris and the other Mantu brands)
  has a required "I agree to Mantu's Terms and Conditions" box. That is a terms
  acceptance, so it is yours. The posting header names the job's working
  language, which settles a question the English description can leave open.
- **BambooHR** tenants can require a street address and postcode, and a
  honeypot field sits first in the form; it is never filled. The visible
  reCAPTCHA makes every BambooHR form a hand-off anyway.

### Kariyer.net from a logged-in account

Measured on 9 and 10 Oct:

- Logged in, `fetch()` returns an empty page shell for postings and searches.
  Navigate to each page instead.
- The search is not a title search: a work-model word in the keywords empties
  the list, and `node.js` finds 2 cards where `node` finds 16. Filter the cards
  on your own `title_keep`.
- Some postings are open only to candidates with a disability and say so only
  when you submit. Nothing is sent; it is recorded as a skip.
- Some employers add a data-consent box under their questions. It is ticked
  only when your profile gives consent for application data; otherwise the
  posting is handed back. Postings under one group account count as one company
  for the same-company window.
- With the Chrome window in the background, coordinate clicks land nowhere.
  The notes say how to submit and confirm anyway.

### Lever already knows you applied

A posting you applied to by hand, before Seekter tracked anything, lands on
Lever's `/already-received` page after submit, with the date of your earlier
application, and nothing new is sent. Measured 9 Oct on an application from
six months earlier. Seekter now records it as applied on that date instead of
treating it as an error.

### Upgrading

Nothing to migrate. Your `profile/`, `applications/` and `runs/` are
git-ignored and untouched.

## v0.5.0 — 9 October 2026

Two sources that need no browser: the job boards of the companies you would
most like to work for, read straight from their applicant tracking system, and
the monthly Hacker News "Who is hiring?" thread.

### New: an employer watchlist

Most product companies publish their job board as open JSON through Greenhouse,
Ashby, Lever or Workable. List the ones worth watching under `employers` in
`profile/settings.json` (name, ats, slug) and `scripts/employer_sweep.py` reads
every board in step 1, one a second, filters titles with your `title_keep` and
`title_drop`, drops what the tracker already holds and prints the location line
the employer wrote. A posting is seen the day it opens, before any aggregator
copies it.

Measured 9 Oct: 29 boards, 1,761 postings, 34 title matches, 2 applications.
Most matches died on a location line the API had already returned, so read that
column first. The slug is the board's own id, not the company's name: one
obvious slug belonged to a defence contractor and another company's was its
name plus two digits. Open the board once before adding a row.

### New: Hacker News "Who is hiring?"

`python3 scripts/employer_sweep.py --hn` reads the month's thread through the
public Algolia API and keeps the posts that mention your titles. The October
thread had 248 posts, 29 mentioned the titles, about 5 were real roles in the
discipline and 1 became an application. Many posts are by founders and some
apply by email, which stays yours to send.

### Every Hacker News post looked like the same posting

HN posts all live at `/item?id=<n>`, and the tracker ignored the query, so a
whole thread keyed as one posting: a post skipped in the morning made the next
application from the same thread report DUPLICATE. Posts now key as `hn:<id>`.
This only affected anyone who logged HN links by hand before this release.

### Upgrading

Nothing to migrate. To use the watchlist, add `employers` rows to
`profile/settings.json` (the template shows the shape). If you logged a Hacker
News link before this release, its row in `skipped.md` keeps the old key
`news.ycombinator.com/item`; change it to `hn:<id>`. Your `profile/`,
`applications/` and `runs/` are git-ignored and untouched.

## v0.4.0 — 8 October 2026

The first release with a contributor's runs in it: Doğan Can Karataş measured
the kit for a candidate who applies only in their own country, on Windows
(#39). It brings a new board, two new form systems and a fix that was hiding
every job on one platform.

### On Windows the freehire sweep found nothing

`freehire_sweep.py` decoded curl's output with the console's legacy code
page, so every response failed to parse and the sweep reported 0 jobs, which
reads exactly like a quiet market. The summary line then crashed on its arrow.
Both are fixed. If you ran Seekter on Windows before this release, step 1 never
worked for you.

The same script refused a profile with `home_country` set and `regions` empty.
That is the only correct setup when freehire's own region for your country
returns nothing (`regions=turkey` returned 0 on 6 Oct while `countries=TR`
returned 314), so a home-country-only candidate could not sweep at all. Now
either one is enough, and a test holds it.

### LinkedIn already knew what you applied to by hand

In `read` mode the job detail carries `applyingInfo`, which says when you
applied through LinkedIn yourself. The run never read it, so postings you had
already sent through Easy Apply came back on your list to send. Measured 8 Oct:
four of them. The run now records those as applied and leaves them off.

A thin geo with a short window returns padding rather than keyword matches;
on a small market, search the country over a week.

### New: Kariyer.net, Heroty and Manatal

- **Kariyer.net**, Turkey's largest job board: the search URL shape that
  actually filters by keyword, and the logged-in apply flow, which pre-fills
  answers from earlier applications. Read each one against your profile before
  sending.
- **Heroty** keeps closed postings readable until you press apply.
- **Manatal** (`careers-page.com`) does nothing on submit until a terms box is
  ticked. Accepting terms is yours, so it becomes a hand-off.
- freehire's Turkish postings are mostly leads behind a sign-up wall, not apply
  links; resolve the employer first.

### Ashby sends nothing while the CV is still uploading

The first submit after a CV upload returned "We're updating your application
(e.g. uploading files), please try again" on all four Ashby forms filled on 7
and 8 Oct, and sent nothing. Waiting a few seconds and submitting again gives
the real result.

### Upgrading

Nothing to migrate. To use Kariyer.net, add it to `boards` in
`profile/settings.json`. Your `profile/`, `applications/` and `runs/` are
git-ignored and untouched.

## v0.3.1 — 7 October 2026

Reading is paced like a person, and a verification page is a stop sign.

### LinkedIn reads kept a fixed rhythm

In `read` mode every LinkedIn request was followed by exactly 3 seconds of
waiting. Detection reads volume and rhythm, and a gap that never varies is a
rhythm no person keeps. `linkedin.read_limits` gains `max_gap_seconds`, and
each pause is now drawn at random between `min_gap_seconds` and it: 4 to 9
seconds by default. A run reads a little slower; the limits on searches and
details are unchanged.

### Boards read in the browser had no pace at all

Only LinkedIn had written limits. Indeed, Glassdoor and any listing page
Seekter scrolls in your Chrome had no rule for the gap between pages, and no
rule for what a Cloudflare or CAPTCHA page meant. They now get the same random
4 to 9 seconds, one page at a time, and a verification page ends that board for
the run: it goes in the report and the run moves on. The one exception is a
cause the board's own file has measured, like Indeed's empty location, which is
fixed and retried once. Public APIs stay sequential.

### Upgrading

Nothing to migrate. If your `profile/settings.json` sets `min_gap_seconds: 3`,
it keeps 3 as the lower bound and 9 from the template as the upper; raise it to
4 for the new default. Your `profile/`, `applications/` and `runs/` are
git-ignored and untouched.

## v0.3.0 — 6 October 2026

Settings move into one file with defaults, and a setup you stop halfway still
runs.

### One `{{` in the profile stopped every run

`/seekter-run` refused to start while `profile/profile.md` still held a single
`{{…}}`, even when the missing answer was optional, like a notice period or a
second CV. A setup interrupted at question 20 of 40 gave you nothing to run.
Now only four things stop a run, because no default can stand in for them: the
profile itself, the application email, the default CV and the country you live
and work in. Every other gap is asked when a form needs it, the way `ASK` always
was.

### Every switch in one file

Settings were split between `profile/search.json` and sentences inside
`profile/profile.md`, so changing one meant knowing where it lived.
`profile/settings.json` now holds every switch and number: queries, title
filters, boards, the LinkedIn mode and its limits, the same-company window.
Each key is documented in `templates/settings.json`, and a key you leave out
runs on the template's default. You can edit the file by hand.

- `/seekter-init` creates it right after the disclaimer and writes each answer
  the moment you give it.
- `python3 scripts/seekter.py settings` shows what is in effect, and
  `settings --check` lists what is still on a default and says plainly what, if
  anything, needs fixing.
- Guardrails are not settings. Nothing in the file can make Seekter solve a
  CAPTCHA, create an account, accept terms for you, or fill LinkedIn Easy Apply.

### Upgrading

Nothing to do by hand. Your `profile/search.json` is renamed to
`profile/settings.json` the first time a command reads it, with every value
unchanged. If you have created a `settings.json` yourself and still have the old
file, Seekter warns instead of guessing; move what you need and delete
`search.json`. Your `profile/`, `applications/` and `runs/` are otherwise
untouched.

## v0.2.2 — 6 October 2026

A bug-fix release. The 30-day rule from 0.2.1 could hold a company you had never
applied to, and a held posting is skipped, so the cost was an application.

### The same-company check matched part of a word

`check` and `check-many` compared company names as substrings. A short name
matched any company that contained it: measured 5 and 6 Oct, "telli" matched
Intellias and Intermedia Intelligent, and "Flex" matched WorkFlex and Engiflex.
Both were held under the 30-day rule, and the run reported them as on hold
rather than new, which reads like a correct decision. If you are on 0.2.1, any
posting held by a company whose name is part of another word may have been
skipped for nothing; the report's "On hold" list names the earlier role, which
is the place to check.

The check now matches the name or whole words of it. "Hays" still matches
"Hays Poland"; "Flex" no longer matches "WorkFlex".

### A record's answers could only be added by hand

A hand-off often gets its free-text answers after the record exists. There was
no command for it, and the tracker is meant to be written only through the CLI.
`move` now takes `--answers` and appends them to the record's Answers section.

### Running the same move twice wrote the log line twice

A batch of rejections run twice doubled the line on 27 records. `move` now skips
a line identical to the last one, and `normalize` collapses adjacent repeats in
files you already have.

### Also

- `MANIFESTO.md` is new: why Seekter exists and the principles it is built on.
- `CONTRIBUTING.md` asks for a proposal issue before anything larger than a fix.
- The README no longer lists salary among the rules postings are filtered
  against; pay is only ever an answer to a form question.
- Ashby: the application form can be read before a tab is opened, from the job
  page's own public endpoint.
- Teamtailor: a knockout answer dims the form and looks exactly like a frozen
  page. The tell is a line under the radios.
- Working Nomads: apply links resolve with a plain `curl`, no browser needed.

### Upgrading

Nothing to migrate. Replace the files and keep your `profile/`, `applications/`
and `runs/`; they are git-ignored and not touched. To clear doubled log lines
from an earlier double run, run `python3 scripts/seekter.py normalize`.

## v0.2.1 — 4 October 2026

A bug-fix release. Both fixes are about the tracker letting something through
that it should have stopped, and neither showed up as an error.

### A second application to the same company could be rejected silently

Greenhouse lets an employer auto-reject a candidate's further applications to a
department within a window, or after a rejection. The rejected application is
marked "blocked by auto reject rule", and the candidate is told only if the
employer has switched the email on. Seekter treated a second role at the same
company as a fresh posting, and on a good day it could send several. Measured
2 Oct: two roles at one company and a second role at another went out the same
afternoon. If the employer uses that rule, the second one may never have been
read, and to a recruiter it looks like the mass applying they filter out.

`check` now holds the company: it exits 2 with `HOLD` when there is already an
application, a pending hand-off or a rejection there within the window, or an
interview or offer at any date. The run skips a held posting, says which earlier
role and date held it, and lists it under its own heading in the report so you
can overrule it. When one run finds two roles at the same company, only the
better fit goes out. A link you bring yourself counts as your decision and is
applied, with a note. The window is `same_company_days` in `profile/search.json`,
30 days by default.

### `check` passed a bare LinkedIn id as new

`check-many` has always read a bare number as a LinkedIn job id. `check` did not:
it keyed the number as it was, matched nothing, and printed NEW for a job
already in the tracker. Since 0.2.0 tells the run to dedup alert-mail postings
on their LinkedIn id, that check could have let a duplicate through. Both
commands now read the number the same way.

### Also

- One local-language search term in the Indeed notes was spelled in plain
  ASCII, so the 0.2.0 language sweep missed it.

### Upgrading

Nothing to migrate. Without `same_company_days` in `profile/search.json`, the
window is 30 days; add the key to change it. `profile/`, `applications/` and
`runs/` are git-ignored and untouched.

## v0.2.0 — 4 October 2026

The release that changes what Seekter does on LinkedIn. Until now it filled
Easy Apply forms and searched LinkedIn through its internal API, and LinkedIn
restricts accounts for exactly that. Nothing in the kit said so. This version
stops acting on LinkedIn, makes reading it a choice you make knowingly, and
tells you what you take on before the first run.

### Seekter was automating LinkedIn, and LinkedIn restricts accounts for it

LinkedIn's help page on prohibited software does not permit browser extensions
that "scrape, modify the appearance of, or automate activity on LinkedIn's
website", and says accounts that use them risk being restricted or shut down.
Seekter drives your browser through an extension. On 0.1.x a daily run filled
Easy Apply, ran around 40 searches through LinkedIn's internal API and harvested
the notification feed, all from your own account. If you have been running it
daily, that is what LinkedIn has been seeing. The User Agreement also rules out
the obvious fallback of a second account.

Now:

- **Easy Apply is never filled, in any mode**, and no action is taken on
  LinkedIn: no saving, following, messaging or alert editing. Easy Apply
  postings come back to you in the report as a list to send yourself.
- **By default Seekter does not open LinkedIn at all** (`linkedin.mode: email`).
  It reads your LinkedIn job-alert emails in your inbox and finds each posting
  on the employer's own application system. A digest mail shows only about six
  of its matches (measured 4 Oct: "30+ new jobs" above six cards), so narrow
  alerts lose much less than broad ones.
- **Reading LinkedIn is opt-in** (`linkedin.mode: read`), and setup asks with a
  plain warning that it is against LinkedIn's terms. It is read-only and
  limited: at most 15 searches and 60 job details per run, 3 seconds apart, one
  at a time. A "too many requests" error, a security-check or login redirect, or
  an unusual-activity page stops it for the run and switches the mode back to
  `email`.

The cost is volume. On 2 Oct the searches found 352 postings and the alert
feed 63, so `email` mode on its own finds far fewer.

### Your own links come first

Finding a posting takes a person seconds; filling its form is the work. Paste
links into the chat or drop them in `profile/links.txt` (git-ignored), and they
are filled before every other source. A LinkedIn job link is fine: Seekter
finds the employer's own form behind it, or hands it back to you if it is Easy
Apply.

### Nobody was told what they were taking on

Seekter sends applications in your name, uses other sites under their terms
and runs on a paid Claude plan. None of that was written down, and "Seekter is
free" read as the whole story.

- `DISCLAIMER.md`: what you are responsible for, whose terms you follow, no
  warranty, no affiliation, and that Seekter is free but running it is not.
- `PRIVACY.md`: Seekter collects nothing, and this is where your data goes
  while it works: Anthropic, the employers you apply to, the job sources, and
  your inbox, read-only.
- `/seekter-init` now opens with one sentence covering those points and goes on
  only on a yes. The README has the same three points above Quick start.

### The references spoke one candidate's language

The kit was written during one person's job search, and twenty-odd reference
files used that person's language and country as their examples: translated
button labels, local search terms, a city spelled two ways, a dial code. A user
elsewhere would have needed their own copy of each line. Every lesson is still
there, now written to hold in any language and country, with `<CITY>`,
`<COUNTRY>` and `+<code>` where a place is needed.

### Also

Twelve form-system traps measured on 2 Oct, among them:

- Ashby can show a filled field as "Missing entry"; filling it a second way
  clears it, and the first Submit may only blur the field.
- Lever validates every `urls[...]` field as a URL, so free text in one fails
  the submit silently.
- Teamtailor's required Address can be a location search box that a script
  cannot fill.
- CleverStaff uploads the CV and then rejects the form anyway, until the file is
  tied to its field.
- Oracle Cloud HCM creates an account on its first screen, so it is handed to
  you.
- Google Forms records the signed-in Google account's email with an upload,
  which may not be the address your profile names.

### Upgrading

- The next `/seekter-run` asks you the disclaimer once. A no stops the run.
- Your profile starts in `email` mode. Create your LinkedIn job alerts with
  **Email** delivery, one per row of `linkedin.searches` in
  `profile/search.json`, narrow rather than broad. To keep reading LinkedIn
  searches yourself, set `linkedin.mode` to `read`; Easy Apply stays off either
  way.
- Nothing else to migrate. `profile/`, `applications/` and `runs/` are
  git-ignored and untouched.

## v0.1.2 — 2 October 2026

A bug-fix release. Two of the three fixes are about things the kit did without
telling you: one sent an application a step early, the other left rejections
looking like open applications.

### On a one-page Easy Apply form, "next" was Submit

The Easy Apply driver advances by taking the last non-cancel button in the
modal. On a multi-page form that is Next or Review. On a form with a single page
it is **Submit**, and the driver had no way to tell the two apart.

Measured 2 Oct: the modal opened with no page counter, the first advance sent
the application, and there was no review step. Nothing false went out, because
the contact page is checked before advancing. But the review step is also where
the pre-ticked "follow this company" box gets unticked, and that opt-in was left
on. If you use Easy Apply on 0.1.1, some of your one-page applications have
probably gone out the same way.

The driver now reads the page counter before every advance. A modal with no
counter is one page, so the next press submits, and the run reads the whole
form before deciding to.

### The blacklist never saw the company name

The aggregator list and your profile's blacklist are both lists of company
names. The filter ran them over the posting's title, description and apply
host, which do not carry the company. Measured 2 Oct: an aggregator named in the
skill's own list got through every filter and was only caught once its job page
was open. The company is now part of what the filter reads. On LinkedIn the
reliable source for it is the first `"name"` in the detail response, because
`companyDetails` often comes back as `?`.

### Some rejections did not read as rejections

`/seekter-log` finds rejections with a regex. It had no phrasing for a role
being filled or closed, and it had `not moving forward` but not `unable to move
forward`. Measured 2 Oct: one rejection used both phrasings and matched nothing.
A miss does not look like an error. It looks like an application that is still
open, so the row stays `applied` indefinitely. The list now covers the
filled/closed phrasings and `unable to move` / `unable to proceed`.

The same sweep found Outlook's `[role=option]` rows working again, four days
after they had disappeared. The inbox reference now says to probe all three list
selectors and use whichever one answers.

### Also

- `CHANGELOG.md` is new since 0.1.1. The 0.1.1 zip did not include it, so this
  is the first download that does. `/seekter-git` now covers releases too: once a
  pull request is merged, it can write the entry and publish the version.
- The README opens on a new cover image. The image it used to point at had been
  deleted, so the first line had been broken.
- Indeed: the tenth measured pass returned nothing new for the tenth time.
- Jobicy: eight tags returned zero rows from an API that was otherwise
  answering normally.
- LinkedIn: notifications against searches, measured a seventh time. 13 ids of
  63 overlapped.

### Upgrading

Nothing to migrate. Replace the files and keep your `profile/`, `applications/`
and `runs/`; they are git-ignored and are not touched.

## v0.1.1 — 1 October 2026

A bug-fix release. If you are on 0.1.0 and run `/seekter-run`, one of the five
sources has been quietly doing nothing for you, and that is what this fixes.

### LinkedIn Easy Apply never ran if your LinkedIn is not in English

The Easy Apply driver matched on the English button names: "Easy Apply", "Next",
"Review", "Submit application". On an account set to another
interface language those labels are translated, and every check failed.

It fails silently, which is what makes it expensive. There is no error. The
detection just reports that a posting has no Easy Apply button, which reads
exactly like a posting that has closed. Measured on a 250-posting sweep: the
entire Easy Apply tier was skipped, sixty candidates went unopened, and two live
postings were recorded as closed. The run's own priority order calls that tier
the last one to cut, because it costs about six calls and no upload.

The driver no longer matches button text at all. It finds the modal from its
heading and takes the last non-cancel button inside it, which works in any
language.

Four more Easy Apply mechanics were measured and written down at the same time:
the modal opens on a JS MouseEvent dispatch and on nothing else; the
work-authorization questions arrive in either order, so they have to be read
rather than answered by position; the coordinate frame can change between two
postings inside one run; and the email field is a dropdown that may hold more
than one address.

### The queue the skill promised now actually exists

`/seekter-run` told you that if a session ran short, "the queue survives into the
next run". Nothing ever wrote it down. A run that sweeps 250 postings and applies
to eight has resolved 240 apply URLs that live only in a browser tab, and the
next session starts from nothing.

The run now writes `runs/<date>/queue-A.md` before its report, one row per
unworked posting with its resolved apply URL, and says in the file that the A/B/C
letter is a sorting hint rather than a verdict.

### Also

- Ashby: a form's own country-of-residence list outranks the location in the
  posting header. A header naming four countries looks like a closed door; the
  form offering yours is the employer saying otherwise.
- Indeed: ninth measured pass, ninth with nothing new.
- LinkedIn: notifications against searches, measured a sixth time. 7 ids of 44
  overlapped. The two channels still do not substitute for each other.

### Upgrading

Nothing to migrate. Replace the files, keep your `profile/`, `applications/` and
`runs/`, which are git-ignored and untouched.

## v0.1.0 — 30 September 2026

First tagged version. Seekter had been in daily use for a month; this is the
point where that stopped being an untagged moving target.

- **12 documented job sources**, plus a file on the ones that were measured and
  found not worth the calls.
- **24 documented application form systems**, each written from real filled
  forms, plus a file of one-offs.
- A markdown tracker written only through `scripts/seekter.py`, with a normalised
  `job_key` so the same posting reached through LinkedIn, an aggregator and the
  company's own site is still caught as one.
- **39 tests** over the tracker CLI: `python3 -m unittest discover tests`.
- Guardrails that do not bend: no CAPTCHAs, no account creation, no passwords, no
  accepting terms of use, no messages sent as you, and no answer it cannot verify
  from your profile.

Numbered 0.1.0 rather than 1.0.0 because the structure is about to move: a Claude
Code plugin is next, which means the skills relocate and the tracker root stops
being "wherever you cloned this". 1.0.0 is the version where that has settled.
