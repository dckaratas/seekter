# Tailored CV, one per posting

Runs only when `tailor_cv` is `true` in `profile/settings.json` (off by default: it adds a few minutes to every
form that takes a file). Read this file before the first upload form of a run that has it on.

## When

- **A form that takes a CV file** (Greenhouse, Lever, Ashby, BambooHR, Peoplise, company sites…): build a
  tailored PDF before the form, upload it instead of the default CV.
- **A board that sends a CV stored in the account** (Kariyer.net's Özgeçmiş step, LinkedIn Easy Apply, any
  "use my profile" path): the CV cannot change per application without editing the user's account, which is
  theirs. Leave it alone. Where the board has an optional cover-letter step, tailor that instead (§5 of
  `/seekter-run`), written from the same keyword match as below.
- A posting whose requirements the candidate misses by a mile (a required degree field, several core years)
  gains nothing from tailoring. Apply with the default CV, or skip on the usual filters; don't spend the build.

## What may change, and what never does

The tailored CV is the default CV **reordered and reworded toward one posting**, nothing more.

| May change | Never changes |
|---|---|
| The headline and the summary paragraph | Employers, titles, dates, degrees, schools |
| The order of jobs' bullets, and of skill groups | Numbers: only the ones in the profile's fact bank |
| Which bullets a role keeps (an off-target role shrinks to one line) | Any skill, tool, method or language the profile does not list |
| The posting's own wording for a skill the candidate has ("Spring MVC" for a Spring Boot REST service, only once the candidate confirmed it) | Language levels |
| Dropping certifications unrelated to the posting | Contact details: from the profile, as is |
| The CV's language, when the posting asks for one the profile allows | |

The build starts from the profile, not from the posting:
1. Pull the posting's requirement keywords (languages, frameworks, practices, methods, domain).
2. Mark each one **have** (in the profile's stack, facts or stories), **missing**, or **unclear**.
3. **Unclear is a question, not a yes.** A framework the candidate probably used because it sits under one
   they listed, a method the team probably followed: ask, then write the answer into the profile with the
   candidate's own words, so the next CV and every form question can use it. Measured 12 Oct 2026: a Java
   posting asked for Spring MVC and Agile; both were true and neither was in the profile, and asking took one
   message.
4. Missing stays missing. The report says which requirements were missing, so the user can judge the odds.

## Format that ATS parsers read

- One column, no tables, text boxes, icons, photos or skill bars. Standard section headings: Summary,
  Experience, Projects, Skills, Education, Certifications, Languages (or the posting language's equivalents).
- **Dates on the same line as the title, in normal text flow.** Measured 12 Oct 2026: dates floated to the
  right with CSS were extracted *after* the role's bullets, so a parser reading the text in order attaches
  them to the wrong block.
- **Skill groups as list items, one per line.** Separate `<p>` lines were extracted as one run-on line.
- Real Unicode text (no outlined or image text), a common font (Arial, Calibri, Helvetica).
- One page when the default CV is one page; never longer than the default.
- No em dashes if the profile's voice bans them; plain hyphens are the safest separator.

## Build and render

Write the CV as HTML under `profile/documents/tailored/<YYYY-MM-DD>-<company>-<role-slug>.html` (git-ignored
with the rest of `profile/`), then print it to PDF with headless Chrome or Edge:

```bash
chrome --headless=new --disable-gpu --no-pdf-header-footer \
  --user-data-dir=<a throwaway folder> --print-to-pdf=<absolute out.pdf> file:///<absolute in.html>
```
- Build the output path in a plain variable first. Measured 12 Oct 2026 on Git Bash: writing it inline as
  `"…\\${f%.html}.pdf"` left the `${…}` unexpanded and the PDF landed next to the folder under a literal
  `tailored${f%.html}.pdf` name, while the old PDF in place looked like a fresh render.
- On Windows Chrome lives at `C:\Program Files\Google\Chrome\Application\chrome.exe`, Edge at
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`; on macOS `"/Applications/Google
  Chrome.app/Contents/MacOS/Google Chrome"`.

## Verify before uploading

```bash
pdftotext -enc UTF-8 -layout <out.pdf> -     # the text a parser sees, in order
pdftotext -enc UTF-8 <out.pdf> - | grep -c $'\f'   # pages
```
- **Pass `-enc UTF-8`.** Without it `pdftotext` writes Latin-1 on some builds and silently drops letters
  outside it, so a correct PDF reads as broken (measured 12 Oct 2026: a Turkish name lost two letters in the
  default CV and in the new one alike, and both were fine with `-enc UTF-8`). Check the candidate's name,
  every place name and every non-ASCII letter in the extracted text.
- Read the extracted text top to bottom: every date next to its role, every heading before its section.
- Grep the extracted text for each number and check it against the fact bank.

## Record it

Upload the tailored PDF, and put its file name in the tracker record's `--notes`, with the requirements
marked missing. The user can open exactly what an employer received.
