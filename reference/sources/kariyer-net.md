# Kariyer.net

Turkey's largest general job board. First measured 6 Oct 2026, logged out.

- **Search URL:** `https://www.kariyer.net/is-ilanlari/<city-slug>?ct=<city-id>&kw=<keywords>` (Ankara is `ankara?ct=6`); without a city, `https://www.kariyer.net/is-ilanlari?kw=<keywords>`. **Slug-style keyword URLs (`/is-ilanlari/ankara-java-developer`) ignore the keyword** and return the city's whole list, sponsored rows first. Typing in the search box and pressing Return also did nothing; the "İş Ara" button produces the `?ct=&kw=` URL above.
- **Cards:** `a[href*="/is-ilani/"]`; the link text carries title, company, city, work model (`İş Yerinde` / `Hibrit` / `Uzaktan / Remote`) and age. Rows prefixed `Sponsorlu İlan` are ads that ignore the keyword. Rows marked `accessible` are roles reserved for candidates with a disability.
- **Details:** `fetch('/is-ilani/<slug>')` from a kariyer.net tab returns the full page HTML, logged out, so details can be read without navigating (same origin).
- **Volume:** one city, six keywords, three-day freshness not available: 98 unique rows, 8 on-title, most of them .NET or on-site.
- **Applying needs a Kariyer.net account** (the "Başvur" button asks to log in; a Google sign-up modal opens on first load: never accept it). Logged out, every fit is a hand-off. When the user is logged in to Kariyer.net in the same Chrome, the run applies through the site's own Başvur button (the login is theirs; Seekter never types a password).
- Cookie banner: "Reddet" at the bottom.

## Applying (logged in), measured 7 Oct 2026

- "Başvur" on the posting opens `/basvuru-tamamlama/<jobCode>`: three steps. **Özgeçmiş** uses the CV stored in the user's Kariyer.net profile (no upload). **Ön Yazı** is optional and defaults to "Ön yazı eklemek istemiyorum". **Şirket Soruları** are the employer's questions.
- **Answers are pre-filled from the account's saved answers** (`Şirket Sorularım`), including ones from earlier applications and ones the user saved long ago. Read every pre-filled value against the profile before submitting; a value the profile does not cover (travel restriction, shift/weekend work) is not verified just because the site filled it.
- Dropdowns are custom widgets: coordinate-click the field, then the option. English scale: Başlangıç / Orta / İyi / İleri / Ana Dil. Years scale: 0-1 / 1-3 / 3-5 / 5-7 / 7+.
- "Başvurunu Tamamla" lands on `/basvuru-onay?jobCode=…&applyCode=…`: that page is the confirmation. Answers stay editable for 48 hours under Başvurularım.
- The `ref` click on "Başvur" sometimes does nothing; a coordinate click works.
