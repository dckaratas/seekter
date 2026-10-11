# Factorial

Factorial's careers pages: `<co>.factorial.com/job_posting/<slug>-<id>` (also `<co>.factorialhr.com/job_posting/...`). "Apply now" opens the form at `/apply/<slug>-<id>`; the confirmation is `/<id>/thanks`. No account. First measured 11 Oct 2026.

- **Reject the cookie banner first** ("Reject cookies", bottom right). It sits over the "Apply now" button on a small window.
- **The posting header carries the contract, salary band and work model** ("Permanent · Full time · €35,000 - €45,000 Annual · Remote"). Read it before the description; the band is the employer's own.
- **Plain named inputs; the native setter works**: `first_name`, `last_name`, `phone`, `email`, `personal_url`, `cover_letter`, and custom questions as `aq_<id>`. `phone_prefix` is a real `<select>` whose options read "<COUNTRY> (+<code>)"; pick by the dial code.
- **Radios take a plain `.click()`** and read back with `.checked`. Read each question's label from the page text: the inputs carry only the option text.
- **CV:** `input[type=file][name=cv]` is hidden; make it visible, `find` it, then `file_upload`.
- **The privacy acknowledgement is a styled checkbox** (`terms_of_service`, "I have read and acknowledge the Privacy Policy"). A `ref` click does not tick it; a coordinate click on the visible box does. It is the application's own data notice. The talent-pool box under it (`consent_to_talent_pool`) is an optional opt-in: leave it.
