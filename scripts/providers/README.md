# Job board providers

One file per application system, read by `scripts/employer_sweep.mjs` for the employer watchlist (`employers` in `profile/settings.json`, rows of `{name, ats, slug}`). The file name is the `ats` value.

Each file exports one function:

```js
export default async function board(slug, net) { … }
```

- `slug` is the row's `slug`, in whatever shape this system needs (its own comment says which).
- `net.json(url, post?)` returns parsed JSON or `null`; `net.text(url)` returns the body or `""`. Pass `post` (an object) for a JSON POST. Use these, not `fetch`, so the tests can answer without the network.
- `net.queries` is the profile's search terms, for systems that only search and cannot list a whole board.
- Return `[{ title, location, url }]`, one entry per open posting, or `null` when the board does not exist. An empty array means the board exists and has nothing open.

A provider can also export `live(url, net)`, which `scripts/live.mjs` calls right before a form: return `"open"`, `"closed"` or `null`. Return `null` for a URL that is not this system's and whenever the answer is unclear; only a definite answer from the posting itself counts. Ask the posting's own page or endpoint, not the board list, because some systems leave open postings off the list (Ashby's unlisted postings). `net.status(url, post?)` returns `{ status, body }` for this.

The sweep filters titles, drops postings already in the tracker and prints what is left. A provider only reads a public, documented-enough endpoint that needs no account and no key; anything behind a login is a hand-off, not a provider.

Adding one is a single-file pull request: the file, a test in `tests/seekter.test.mjs` with a fake response, and a row in `reference/sources/direct-employer.md`.
