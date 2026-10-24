# Peoplise

Turkish recruiting platform used by banks and large employers. Postings at `live.peoplise.com/<company>/Application/Landing/<uuid>`; LinkedIn's offsite apply link points there. First measured 9 Oct 2026.

- **The landing page carries the first step of the form**: first name, surname, email, three `chkLegalDocuments` checkboxes and a "Şimdi Başvur" submit, under an invisible reCAPTCHA v3 (`GoogleCaptchaToken`, `.grecaptcha-badge`). No CV upload on this step; what follows was not reached.
- **All three checkboxes are mandatory, although none carries `required`.** Submitting with one unticked shows "Bu alanı işaretleyiniz" and stays on the page. On one bank tenant the three were: the privacy notice (aydınlatma metni), the consent text (rıza metni), and **consent to share the data with the parent holding company**. The last is not the application's own consent; Seekter does not tick it for the user, so the posting becomes a hand-off with the first two fields and boxes filled.
- `form_input` sets the name, email and checkbox values and they read back correctly.
- **The first step differs per tenant.** Measured 23 Oct 2026 on an airline tenant (`live.peoplise.com/hq/…`): name, surname, email, a phone code `<select>` plus `PhoneNumber`, a `CvFile` upload, and only **two** `chkLegalDocuments` boxes (the privacy notice and the employer's own processing consent), both the application's own. No holding-sharing box, so nothing forces a hand-off there. Read each box's label before deciding.
