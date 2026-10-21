# Personio

- **URLs:** `*.jobs.personio.com|de`. Easiest ATS, ~4 calls.
- **Set values:** native setter on stable ids: `field-first_name`, `field-last_name`, `field-email`, `field-phone`, `field-available_from`, `field-salary_expectations`, `field-custom_attribute_*`. Phone digits only, no `+` (`90<PHONE_LOCAL>`).
- **Dropdowns:** Country list lacks the home country — leave blank if optional and put `<CITY>, <COUNTRY>` in "City"; if mandatory → hand over. "Preferred Work Location" is a custom multi-select checkbox list (invisible to `querySelectorAll('select')`) → real clicks; tick the cities the posting lists.
- **File upload:** `doc-input-cv`, max 750 kb.
- **Traps:** Usercentrics layer (`aside#usercentrics-cmp-ui` shadow root) blocks the page and shows only "Accept All". Run `await window.UC_UI.denyAllConsents()`, then one real coordinate click on the "cookie settings" link inside it; the layer closes. Coordinate clicks silently lost here when K was wrong — recompute.
- **Submit:** `Bewerbung senden` / `Submit Application`.

## Reached through an aggregator redirect

- Reached from aggregators through a `t.gohiring.com/h/<hash>` redirect. Don't guess the tenant from
  the company name: a hand-built `<company>.jobs.personio.de` guess landed on Personio's own
  marketing site (measured 23 Sept on UP42). Follow the redirect instead.
- Plain ids (`field-first_name`, `field-email`, `field-available_from`, `field-salary_expectations`,
  `field-custom_attribute_<n>`); the native setter works on all of them.
- **`field-available_from` accepts a plain ISO date** (`2026-10-07`) even though it is `type=text`
  with a datepicker attached. No need to fight the calendar widget.
- **Three file inputs, always**: `doc-input-cv`, `doc-input-cover-letter`, `doc-input-other`, all
  with identical `Add file` context, so `find` cannot tell them apart. Disable and hide the other
  two, expose `doc-input-cv`, then `find` and upload; restore afterwards. After upload
  `input.files` is **empty** because Personio swaps the element, so confirm from the filename
  rendered under the `CV*` heading.
- The optional `field-gender` select stays empty; it is demographic data with no employer requirement.

## Personio's own hiring site (`personio.com/careers/<uuid>/apply/`)

Not the `*.jobs.personio.*` form above. Measured 20 Oct 2026:
- The questions are Ashby's (`_systemfield_name`, uuid field names), and `api/non-user-graphql` with org `personio` and the posting uuid lists them, including the select options. The page itself is Personio's own React form.
- **Uploading the CV re-renders the form and gives every input a new random `id`.** Setters written by `id` before the upload hit nothing afterwards. Address fields by `name` (`[name=_systemfield_name]`, `[name^=<uuid prefix>]`), or fill after the upload.
- The yes/no and "how did you hear" questions are native `<select>` elements under a styled shell: set them with the `HTMLSelectElement` value setter plus `change`. "Preferred Work Location" is a custom checkbox list opened by clicking its header; tick by coordinate.
- The country list still has no entry for some countries (see above); leave it empty and put `<CITY>, <COUNTRY>` in City.
- A Usercentrics layer offers only "Accept All" up front; its "cookie settings" link opens toggles (optional ones off by default) and a "Save Services" button, which declines.
- Phone wants digits only: the country code followed by `<PHONE_LOCAL>`, no `+` and no spaces. The closing "I agree" box is a two-year talent-pool consent: optional, leave it.
