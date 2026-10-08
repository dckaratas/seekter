# Manatal (careers-page.com)

Postings at `www.careers-page.com/<company-slug>/job/<id>`, form at `…/apply`. First measured 8 Oct 2026.

- One page, no account. Field `name`s are numeric ids (`1919527`…); read the label from the nearest ancestor `label`, not `label[for]`.
- Native value setter works on text, number and textarea fields. The resume `input[type=file]` is hidden: give it inline styles and an id, then `find` returns it as a file button and `file_upload` works.
- Custom screening questions are plain text/number inputs (years, English level, sponsorship, salary in TRY).
- **The form ends with "I agree to the terms and conditions & privacy policy"** (`input[name=terms_and_condition]`, not marked `required`). With it unticked, Apply does nothing: no request, no validation message, URL unchanged. Accepting terms is the user's, so the posting becomes a hand-off: fill everything and leave the tab open.
- Screenshots of this tab timed out (30 s) while it was in the background; JS reads still worked.
