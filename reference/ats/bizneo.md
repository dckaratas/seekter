# Bizneo

Bizneo-hosted careers sites under a company domain (`opportunities.<company>.<tld>/jobs/<slug>`; the tab title reads "Bizneo" after submit). "Apply now!" opens the form on the same page. No account. First measured 11 Oct 2026.

- **Reject the cookie modal first**; it blocks the "Apply now!" button.
- **Fields are named `inscription_form[...]`**: `user_form` for identity (email, name, last name, gender, country, city, LinkedIn) and `responses_attributes[n][response]` for the employer's questions. Text inputs and plain `<select>`s take the native setter plus `change`.
- **City is a remote search, not a list.** The `region_id` `<select>` holds a single empty option whatever the country, and setting the country does not fill it. Click the visible City box, type at least three letters into the search field that opens ("Please enter 3 or more characters"), wait, then click the "<CITY>, <REGION>, <COUNTRY>" result. The page can scroll while the dropdown opens: take a fresh screenshot before the click, or the typing lands in the next field.
- **"Fill out the form with your CV / Autocomplete fields"** parses the CV with AI and overwrites everything already entered. Attach the CV through the plain "Attach CV" input instead and leave that button alone.
- **The data-processing checkbox** (`inscription_form[terms_and_conditions]`, "you agree to the processing of your data as described in the Privacy Policy") is the application's own consent. Its DOM `.checked` can stay false after a visible tick; confirm with a zoom on the box, not with JS.
- Success shows "Thank you very much for your interest in working with us" and adds `?new_candidate=true` to the URL.
