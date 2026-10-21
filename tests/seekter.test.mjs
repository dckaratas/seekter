// Tests for scripts/seekter.mjs and the sweeps. No packages: node --test tests/
//
// The tracker CLI is the one part of this kit that can lose an application. Every case
// below is either a promise the README makes or a bug that already cost a duplicate
// submission, and the comment says which.
//
// The pure functions are imported directly. Everything that touches the tracker runs the
// real script as a child process against a throwaway repository, because ROOT is derived
// from the script's own location and the exit code of `check` is part of the contract.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as sk from "../scripts/seekter.mjs";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPTS = path.join(REPO, "scripts");
const TODAY = sk.isoDate(new Date());

// ---------------------------------------------------------------- job identity

describe("job identity", () => {
  // job_key is the load-bearing field: it is what makes the same posting reached through
  // three different sites one record instead of three.
  test("an empty url has no key", () => {
    assert.equal(sk.jobKey(""), "");
    assert.equal(sk.jobKey(null), "");
  });

  test("LinkedIn path and query forms agree", () => {
    // The same job arrives as /jobs/view/<id> from the API and as ?currentJobId=<id> from
    // the search page. They must key the same.
    const a = sk.jobKey("https://www.linkedin.com/jobs/view/4468710729/");
    const b = sk.jobKey("https://www.linkedin.com/jobs/search/?currentJobId=4468710729&keywords=x");
    assert.equal(a, "linkedin:4468710729");
    assert.equal(a, b);
  });

  test("Greenhouse forms", () => {
    assert.equal(sk.jobKey("https://boards.greenhouse.io/acme/jobs/4567890"), "greenhouse:4567890");
    assert.equal(sk.jobKey("https://acme.com/careers?gh_jid=4567890"), "greenhouse:4567890");
  });

  test("a UUID anywhere in the path wins and is lowercased", () => {
    const upper = "https://jobs.ashbyhq.com/acme/1E548ADA-1111-2222-3333-444455556666";
    const lower = "https://jobs.ashbyhq.com/acme/1e548ada-1111-2222-3333-444455556666/application";
    assert.equal(sk.jobKey(upper), "uuid:1e548ada-1111-2222-3333-444455556666");
    assert.equal(sk.jobKey(upper), sk.jobKey(lower));
  });

  test("Breezy keys on the id, not the title slug", () => {
    // Measured 25 Sept: an employer renamed a Breezy posting without opening a new one.
    // Keying on the whole path made the rename look like a new job, it passed dedup as
    // NEW, and only Breezy's own server caught the second form.
    const before = "https://acme.breezy.hr/p/ff94f3182ac2-senior-product-designer";
    const after = "https://acme.breezy.hr/p/ff94f3182ac2-senior-product-design-engineer";
    assert.equal(sk.jobKey(before), "breezy:ff94f3182ac2");
    assert.equal(sk.jobKey(before), sk.jobKey(after));
  });

  test("Hacker News posts key on the comment id", () => {
    // Measured 9 Oct: every "Who is hiring?" post lives at /item?id=<n>, so the whole
    // thread keyed as one posting and a skipped post blocked an application.
    const a = sk.jobKey("https://news.ycombinator.com/item?id=49924889");
    const b = sk.jobKey("https://news.ycombinator.com/item?id=49932275");
    assert.equal(a, "hn:49924889");
    assert.notEqual(a, b);
  });

  test("Indeed keeps the id in the query", () => {
    // Without this every Indeed posting collapses to "<host>/viewjob" and the first one
    // tracked makes all the others look like duplicates.
    const one = sk.jobKey("https://uk.indeed.com/viewjob?jk=abc123def456");
    const two = sk.jobKey("https://uk.indeed.com/viewjob?jk=999888777666");
    assert.equal(one, "indeed:abc123def456");
    assert.notEqual(one, two);
  });

  test("a generic id query param on a careers site", () => {
    // Measured 24 Sept: careers.celonis.com had two design roles whose paths were
    // identical and whose ids lived in a query param.
    const one = sk.jobKey("https://careers.example.com/job-detail?jobId=1234567");
    const two = sk.jobKey("https://careers.example.com/job-detail?jobId=7654321");
    assert.equal(one, "careers.example.com:1234567");
    assert.notEqual(one, two);
  });

  test("an /apply suffix and www do not create a second record", () => {
    const plain = sk.jobKey("https://www.example.com/careers/senior-designer");
    const applying = sk.jobKey("https://example.com/careers/senior-designer/apply");
    assert.equal(plain, applying);
    assert.equal(plain, "example.com/careers/senior-designer");
  });

  test("a URL with no path falls back rather than keying on the host", () => {
    // Keying on the host alone would make every posting on that site one record.
    assert.notEqual(sk.jobKey("https://jobs.example.com/#/postings/aaa"), sk.jobKey("https://jobs.example.com/#/postings/bbb"));
    assert.notEqual(sk.jobKey("https://jobs.example.com/?id=aaa"), sk.jobKey("https://jobs.example.com/?id=bbb"));
  });

  test("keys are made the way Python's urlparse made them, not the way URL() would", () => {
    // Every job_key already stored came from urlparse. URL() would percent-encode the
    // path, punycode the host and drop the ;params, and a tracked posting would pass
    // dedup as new. The port was checked against 2,447 real URLs; these are the edges.
    assert.equal(sk.jobKey("https://a.com/p;jsessionid=1?jobId=12345"), "a.com:12345");
    assert.equal(sk.jobKey("http://user:pw@Host.COM:8080/a/b/"), "user:pw@host.com:8080/a/b");
    assert.equal(sk.jobKey("https://foo.com/?u=https://bar.com/jobs/1234567"), "foo.com#u=https://bar.com/jobs/1234567");
    assert.equal(sk.jobKey("example.com/careers/x/apply/"), "example.com/careers/x");
  });
});

// ------------------------------------------------------------- normalisation

describe("normalisation", () => {
  test("slug folds letters that NFKD alone would delete", () => {
    // NFKD only folds a letter that decomposes into base + combining mark. A letter that
    // is its own base character gets deleted instead, so the dotless ı disappeared:
    // "Desıgn Ateliér" became "desgn-atelier".
    assert.equal(sk.slug("Desıgn Ateliér"), "design-atelier");
    assert.equal(sk.slug("İnfo Über"), "info-uber");
    for (const [word, want] of [["Łódź", "lodz"], ["Ørsted", "orsted"], ["Straße", "strasse"], ["Æther", "aether"], ["Đuro", "duro"]]) {
      assert.equal(sk.slug(word), want, word);
    }
  });

  test("slug does not fold two different employers onto one string", () => {
    // The same-company check in `check` compares slugs, so a deletion here is not only
    // cosmetic: before the fix both of these were "lght".
    assert.notEqual(sk.slug("Lıght"), sk.slug("Lght"));
  });

  test("slug truncates without a trailing dash", () => {
    assert.equal(sk.slug("a".repeat(60)), "a".repeat(40));
    assert.ok(!sk.slug("word " + "x".repeat(60), 6).endsWith("-"));
    assert.equal(sk.slug(""), "x"); // never an empty filename fragment
  });

  test("norm lowercases and hyphenates enums", () => {
    assert.equal(sk.norm("Company site"), "company-site");
    assert.equal(sk.norm("  Other  Board "), "other-board");
    assert.equal(sk.norm(null), "");
  });

  test("ats is a function of the url", () => {
    assert.equal(sk.atsFromUrl("https://jobs.ashbyhq.com/acme/x"), "ashby");
    assert.equal(sk.atsFromUrl("https://jobs.lever.co/acme/x"), "lever");
    assert.equal(sk.atsFromUrl("https://acme.com/careers"), "");
  });

  test("an ATS name stored as source moves to ats", () => {
    // A common mix-up in hand-kept trackers: the column says where you applied through,
    // not where you found it. Source becomes the generic "board".
    const r = { source: "Greenhouse", url: "https://boards.greenhouse.io/acme/jobs/1" };
    sk.fixMeta(r);
    assert.equal(r.ats, "greenhouse");
    assert.equal(r.source, "board");
  });

  test("other board is just board", () => {
    const r = { source: "Other board" };
    sk.fixMeta(r);
    assert.equal(r.source, "board");
  });

  test("fixMeta fills the key and reports only real changes", () => {
    const r = { url: "https://www.linkedin.com/jobs/view/123456789/" };
    const changed = sk.fixMeta(r);
    assert.equal(r.job_key, "linkedin:123456789");
    assert.ok("job_key" in changed);
    // Running it again must be a no-op, or `normalize` reports work forever.
    assert.deepEqual(sk.fixMeta({ ...r }), {});
  });
});

describe("skip table cells", () => {
  // A skip row is a markdown table cell, so a reason containing a pipe has to survive
  // being read and written repeatedly.
  test("escaping a cell is idempotent", () => {
    const once = sk.cell("remote | EU only");
    assert.equal(once, "remote \\| EU only");
    assert.equal(sk.cell(once), once); // no second backslash
  });

  test("a reason with a pipe survives a round trip", () => {
    const original = "country list: DE | IT | PT, not TR";
    const row = "| " + [TODAY, "Acme", "Designer", original, "board", "", "k"].map(sk.cell).join(" | ") + " |";
    const cells = sk.splitRow(row);
    assert.equal(cells[3], original);
    assert.equal(sk.splitRow("| " + sk.cell(cells[3]) + " |")[0], original);
  });

  test("newlines are flattened so a cell cannot break the table", () => {
    assert.equal(sk.cell("two\nlines"), "two lines");
  });
});

// --------------------------------------------------------------- the tracker

function makeRepo(prefix, scripts = ["seekter.mjs"]) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(tmp, "scripts"));
  for (const s of scripts) fs.copyFileSync(path.join(SCRIPTS, s), path.join(tmp, "scripts", s));
  fs.mkdirSync(path.join(tmp, "applications"));
  return tmp;
}

function runIn(tmp, script, args, { input, env } = {}) {
  const p = spawnSync(process.execPath, [path.join(tmp, "scripts", script), ...args],
    { input, encoding: "utf8", env: { ...process.env, ...env } });
  return { rc: p.status, out: p.stdout, err: p.stderr };
}

describe("tracker", () => {
  let tmp;
  beforeEach(() => { tmp = makeRepo("seekter-test-"); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const cli = (...args) => runIn(tmp, "seekter.mjs", args);
  const cliIn = (input, ...args) => runIn(tmp, "seekter.mjs", args, { input });
  const add = (kw) => {
    const args = [];
    for (const [k, v] of Object.entries(kw)) args.push("--" + k.replace(/_/g, "-"), v);
    const { rc, out, err } = cli("add", ...args);
    assert.equal(rc, 0, `add failed: ${err}`);
    return path.join(tmp, out.trim().split("\n")[0]);
  };
  const skipsTable = (month = TODAY.slice(0, 7)) => fs.readFileSync(path.join(tmp, "applications", month, "skipped.md"), "utf8");
  const profile = (name, text) => {
    fs.mkdirSync(path.join(tmp, "profile"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "profile", name), text);
  };
  const withTemplate = () => {
    fs.mkdirSync(path.join(tmp, "templates"), { recursive: true });
    fs.copyFileSync(path.join(REPO, "templates", "settings.json"), path.join(tmp, "templates", "settings.json"));
  };

  // -- dedup ------------------------------------------------------------

  test("check is NEW, then DUPLICATE after add", () => {
    const url = "https://jobs.ashbyhq.com/acme/1e548ada-1111-2222-3333-444455556666";
    let r = cli("check", url, "--company", "Acme");
    assert.equal(r.rc, 0);
    assert.match(r.out, /NEW/);
    add({ company: "Acme", role: "Senior Designer", url, status: "applied" });
    r = cli("check", url, "--company", "Acme");
    assert.equal(r.rc, 1, "an already-tracked posting must exit 1");
    assert.match(r.out, /DUPLICATE/);
  });

  test("dedup matches across the url it was first stored under", () => {
    // Measured 23 Sept: a role was submitted a third time because the sweep deduped
    // LinkedIn ids while the record was keyed on the Ashby UUID. `check` runs on the
    // resolved apply URL, and must match either form.
    add({ company: "Acme", role: "Designer", url: "https://jobs.ashbyhq.com/acme/1e548ada-1111-2222-3333-444455556666" });
    const r = cli("check", "https://jobs.ashbyhq.com/acme/1E548ADA-1111-2222-3333-444455556666/application");
    assert.equal(r.rc, 1);
    assert.match(r.out, /DUPLICATE/);
  });

  test("a skipped posting is never evaluated twice", () => {
    // The README promises dedup reads the skip table too.
    const url = "https://acme.com/careers/designer";
    add({ company: "Acme", role: "Designer", url, status: "skipped", notes: "the country list leaves out yours" });
    assert.match(skipsTable(), /the country list leaves out yours/);
    const r = cli("check", url);
    assert.equal(r.rc, 1);
    assert.match(r.out, /DUPLICATE/);
  });

  test("same company, different role is not a duplicate", () => {
    add({ company: "Acme", role: "Designer", url: "https://acme.com/careers/1234567", status: "applied", applied: "2020-01-01" });
    const r = cli("check", "https://acme.com/careers/7654321", "--company", "Acme");
    assert.equal(r.rc, 0);
    assert.match(r.out, /NEW/);
    assert.match(r.out, /same company, other role/);
  });

  // -- one application per company --------------------------------------

  test("a second role at the same company within the window is held", () => {
    // Greenhouse can auto-reject further applications to a department inside a window
    // and tell nobody. Measured 2 Oct: two roles at one company went out the same afternoon.
    add({ company: "Acme", role: "Designer", url: "https://acme.com/careers/1234567", status: "applied" });
    const r = cli("check", "https://acme.com/careers/7654321", "--company", "Acme");
    assert.equal(r.rc, 2, "a recent application at the same company must exit 2");
    assert.match(r.out, /HOLD/);
  });

  test("a skip at the same company holds nothing", () => {
    add({ company: "Acme", role: "Designer", url: "https://acme.com/careers/1234567", status: "skipped", notes: "wrong country" });
    const r = cli("check", "https://acme.com/careers/7654321", "--company", "Acme");
    assert.equal(r.rc, 0);
    assert.doesNotMatch(r.out, /HOLD/);
  });

  test("a live interview holds the company whatever the date", () => {
    add({ company: "Acme", role: "Designer", url: "https://acme.com/careers/1234567", status: "interviewing", applied: "2020-01-01" });
    assert.equal(cli("check", "https://acme.com/careers/7654321", "--company", "Acme").rc, 2);
  });

  test("the window comes from the profile", () => {
    profile("settings.json", '{"same_company_days": 0}');
    add({ company: "Acme", role: "Designer", url: "https://acme.com/careers/1234567", status: "applied", applied: "2020-01-01" });
    assert.equal(cli("check", "https://acme.com/careers/7654321", "--company", "Acme").rc, 0);
  });

  test("a name inside another word is not the same company", () => {
    // Measured 5 and 6 Oct: "telli" matched Intellias and "Flex" matched WorkFlex, and
    // both were held under the 30-day rule for employers never applied to.
    add({ company: "Intellias", role: "Designer", url: "https://acme.com/careers/1234567", status: "applied" });
    add({ company: "WorkFlex", role: "Designer", url: "https://b.com/careers/2345678", status: "applied" });
    for (const [name, url] of [["telli", "https://c.com/careers/3456789"], ["Flex", "https://d.com/careers/4567890"]]) {
      const r = cli("check", url, "--company", name);
      assert.equal(r.rc, 0, `${name} must not be held: ${r.out}`);
      assert.doesNotMatch(r.out, /same company/);
    }
    const r = cliIn("https://c.com/careers/3456789 | telli\n", "check-many");
    assert.ok(r.out.startsWith("NEW"), r.out);
  });

  test("a whole word of the company name still matches", () => {
    // The fix must not lose the matches that were right: "Hays" is "Hays Poland".
    add({ company: "Hays Poland", role: "Designer", url: "https://acme.com/careers/1234567", status: "applied" });
    const r = cli("check", "https://acme.com/careers/7654321", "--company", "Hays");
    assert.equal(r.rc, 2);
    assert.match(r.out, /HOLD/);
  });

  // -- settings ------------------------------------------------------------

  test("an old search.json is moved, not rewritten", () => {
    // Setups from before the settings file have profile/search.json. Its values are the
    // user's; the first read moves the file and keeps every one of them.
    profile("search.json", '{"same_company_days": 0, "x": [1]}');
    add({ company: "Acme", role: "Designer", url: "https://acme.com/careers/1234567", status: "applied", applied: "2020-01-01" });
    assert.equal(cli("check", "https://acme.com/careers/7654321", "--company", "Acme").rc, 0);
    assert.ok(!fs.existsSync(path.join(tmp, "profile", "search.json")));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, "profile", "settings.json"), "utf8")), { same_company_days: 0, x: [1] });
  });

  test("a missing settings file is created from the template", () => {
    withTemplate();
    const r = cli("settings");
    assert.equal(r.rc, 0);
    assert.ok(fs.existsSync(path.join(tmp, "profile", "settings.json")));
    assert.equal(JSON.parse(r.out).linkedin.mode, "email");
  });

  test("a key left out runs on the default", () => {
    // A half-finished /seekter-init leaves a partial file; it must still run.
    withTemplate();
    profile("settings.json", '{"linkedin": {"mode": "read"}}');
    const cfg = JSON.parse(cli("settings").out);
    assert.equal(cfg.linkedin.mode, "read");
    assert.equal(cfg.linkedin.read_limits.searches_per_run, 15);
    assert.equal(cfg.same_company_days, 30);
  });

  test("settings --check stops only on values with no default", () => {
    withTemplate();
    let r = cli("settings", "--check");
    assert.equal(r.rc, 1);
    assert.match(r.out, /profile\/profile.md is missing/);
    fs.mkdirSync(path.join(tmp, "profile", "documents"), { recursive: true });
    profile("profile.md", "Email: {{EMAIL}}\nNotice: {{NOTICE}}\n");
    r = cli("settings", "--check");
    assert.equal(r.rc, 1);
    assert.match(r.out, /application email/);
    assert.match(r.out, /no CV file/);
    assert.doesNotMatch(r.out, /NOTICE/, "an optional gap is asked later, it does not stop the run");
    profile("profile.md", "Email: a@b.c\nNotice: {{NOTICE}}\n");
    fs.writeFileSync(path.join(tmp, "profile", "documents", "cv.pdf"), "%PDF");
    r = cli("settings", "--check");
    assert.equal(r.rc, 0, r.out);
    assert.match(r.out, /using defaults for/);
  });

  test("an old file beside a new one is reported, not lost", () => {
    // Found in an end-to-end test on 6 Oct: init copied the template first, after which
    // the old search.json was never moved and its values silently ignored.
    profile("search.json", '{"same_company_days": 7}');
    profile("settings.json", "{}");
    const r = cli("settings");
    assert.equal(r.rc, 0);
    assert.match(r.err, /both profile\/settings.json and profile\/search.json exist/);
    assert.ok(fs.existsSync(path.join(tmp, "profile", "search.json")));
  });

  test("a broken settings file is reported, not swallowed", () => {
    withTemplate();
    for (const bad of ["{not json", "[1, 2]", '{"linkedin": "read"}']) {
      profile("settings.json", bad);
      const r = cli("settings", "--check");
      assert.equal(r.rc, 1, bad);
      assert.doesNotMatch(r.out + r.err, /at .*\.mjs:\d+/, bad); // a message, not a stack trace
    }
    profile("settings.json", "{not json");
    const r = cli("check", "https://acme.com/careers/1234567", "--company", "Acme");
    assert.match(r.err, /could not be read/, "the hold window must not fall back silently");
  });

  test("true is not a number of days", () => {
    withTemplate();
    profile("settings.json", '{"same_company_days": true}');
    const r = cli("settings", "--check");
    assert.equal(r.rc, 1);
    assert.match(r.out, /same_company_days/);
  });

  test("check reads a bare number as a LinkedIn id", () => {
    // Measured 4 Oct: `check <a bare LinkedIn id>` keyed the number as is and passed a
    // tracked LinkedIn job as new; only `check-many` normalised it.
    add({ company: "Acme", role: "Designer", url: "https://www.linkedin.com/jobs/view/4468710729/" });
    const r = cli("check", "4468710729");
    assert.equal(r.rc, 1);
    assert.match(r.out, /DUPLICATE/);
  });

  test("add refuses a duplicate unless forced", () => {
    const url = "https://acme.com/careers/1234567";
    add({ company: "Acme", role: "Designer", url });
    let r = cli("add", "--company", "Acme", "--role", "Designer", "--url", url);
    assert.equal(r.rc, 1);
    assert.match(r.err, /DUPLICATE/);
    r = cli("add", "--company", "Acme", "--role", "Designer", "--url", url, "--force");
    assert.equal(r.rc, 0);
  });

  test("check-many reads bare ids as LinkedIn and reports per line", () => {
    add({ company: "Acme", role: "Designer", url: "https://www.linkedin.com/jobs/view/4468710729/" });
    const r = cliIn("4468710729\n9999999999 | Acme\n\n", "check-many");
    assert.equal(r.rc, 0);
    const lines = r.out.split("\n").filter((l) => l.trim());
    assert.ok(lines[0].startsWith("DUP"), lines.join("\n"));
    assert.ok(lines[1].startsWith("HOLD"), lines.join("\n"));
  });

  // -- status changes ---------------------------------------------------

  test("a file never changes folder when its status changes", () => {
    // The whole point of the layout: a rejection a month later edits one line.
    const p = add({ company: "Acme", role: "Designer", url: "https://acme.com/careers/1234567", status: "applied", date: "2026-08-14", applied: "2026-08-14" });
    assert.equal(path.basename(path.dirname(p)), "2026-08");
    const r = cli("move", "https://acme.com/careers/1234567", "rejected", "--note", "form mail, 2 days");
    assert.equal(r.rc, 0);
    assert.ok(fs.existsSync(p), "the file moved, and it must not");
    const text = fs.readFileSync(p, "utf8");
    assert.match(text, /status: rejected/);
    assert.match(text, /applied: 2026-08-14/);
    assert.match(text, /form mail, 2 days/);
    assert.match(text, /- 2026-08-14: applied/); // the original log line survives
  });

  test("moving a skip row to applied turns it into a file", () => {
    const url = "https://acme.com/careers/1234567";
    add({ company: "Acme", role: "Designer", url, status: "skipped", notes: "looked like a relocation role" });
    const r = cli("move", url, "applied", "--note", "the form had no country gate");
    assert.equal(r.rc, 0);
    const lines = r.out.trim().split("\n");
    const p = path.join(tmp, lines[lines.length - 1]);
    assert.ok(fs.statSync(p).isFile());
    const text = fs.readFileSync(p, "utf8");
    assert.match(text, /status: applied/);
    assert.ok(text.includes(`applied: ${TODAY}`));
    assert.match(text, /Skipped earlier: looked like a relocation role/);
    assert.doesNotMatch(skipsTable(), /1234567/); // the row is gone
  });

  test("moving a plain pending record to skipped turns it into a row", () => {
    const url = "https://acme.com/careers/1234567";
    const p = add({ company: "Acme", role: "Designer", url, status: "pending" });
    assert.equal(cli("move", url, "skipped", "--note", "account wall").rc, 0);
    assert.ok(!fs.existsSync(p));
    assert.match(skipsTable(), /account wall/);
  });

  test("a skip that was once a real application stays a file", () => {
    // Collapsing it would drop the submitted answers, which is what makes "no sentence
    // goes to two companies" checkable.
    const url = "https://acme.com/careers/1234567";
    const p = add({ company: "Acme", role: "Designer", url, status: "applied", answers: "Why us: because the design system work is real." });
    const r = cli("move", url, "skipped", "--note", "withdrew");
    assert.equal(r.rc, 0);
    assert.ok(fs.existsSync(p), "an application with answers must not become a row");
    assert.match(r.err, /kept as a file/);
    const text = fs.readFileSync(p, "utf8");
    assert.match(text, /status: skipped/);
    assert.match(text, /design system work is real/);
  });

  test("re-annotating a skip keeps the original reason", () => {
    const url = "https://acme.com/careers/1234567";
    add({ company: "Acme", role: "Designer", url, status: "skipped", notes: "country list leaves out yours" });
    assert.equal(cli("move", url, "skipped", "--note", "the form had no country field").rc, 0);
    const table = skipsTable();
    assert.match(table, /country list leaves out yours/);
    assert.ok(table.includes(`[${TODAY}] the form had no country field`));
  });

  test("running the same move twice logs it once", () => {
    // Measured 6 Oct: a batch of rejections was run twice and 27 records got the same
    // log line twice.
    const p = add({ company: "Acme", role: "Designer", url: "https://acme.com/careers/1234567" });
    for (let i = 0; i < 2; i++) {
      const r = cli("move", "https://acme.com/careers/1234567", "rejected", "--note", "2026-10-05, not moving forward");
      assert.equal(r.rc, 0, r.err);
    }
    assert.equal(fs.readFileSync(p, "utf8").split("not moving forward").length - 1, 1);
  });

  test("normalize collapses a repeated log line", () => {
    const p = add({ company: "Acme", role: "Designer", url: "https://acme.com/careers/1234567" });
    const line = "- 2026-10-06: rejected. 2026-10-05, not moving forward\n";
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").trimEnd() + "\n" + line + line);
    assert.equal(cli("normalize").rc, 0);
    assert.equal(fs.readFileSync(p, "utf8").split("not moving forward").length - 1, 1);
  });

  test("move appends answers to an existing record", () => {
    // Measured 6 Oct: a hand-off's answers arrived after the record existed, and the only
    // way to store them was a hand edit the tracker forbids.
    const p = add({ company: "Acme", role: "Designer", url: "https://acme.com/careers/1234567", status: "pending" });
    const r = cli("move", "https://acme.com/careers/1234567", "applied", "--note", "submitted", "--answers", "Teams: design 4-6");
    assert.equal(r.rc, 0, r.err);
    const text = fs.readFileSync(p, "utf8");
    assert.ok(text.includes("Teams: design 4-6"));
    assert.ok(text.indexOf("Teams: design 4-6") < text.indexOf("## Log"));
  });

  test("move rejects an unknown status and an unknown target", () => {
    let r = cli("move", "https://acme.com/x", "ghosted");
    assert.equal(r.rc, 1);
    assert.match(r.err, /status must be one of/);
    r = cli("move", "https://nowhere.example.com/1234567", "rejected");
    assert.equal(r.rc, 1);
    assert.match(r.err, /not found/);
  });

  // -- generated views and reports --------------------------------------

  test("stats counts sent and the response rate", () => {
    add({ company: "A", role: "D", url: "https://a.com/careers/1111111", status: "applied" });
    add({ company: "B", role: "D", url: "https://b.com/careers/2222222", status: "rejected" });
    add({ company: "C", role: "D", url: "https://c.com/careers/3333333", status: "pending" });
    add({ company: "D", role: "D", url: "https://d.com/careers/4444444", status: "skipped", notes: "sector" });
    const r = cli("stats");
    assert.equal(r.rc, 0);
    const s = JSON.parse(r.out);
    assert.equal(s.total, 4);
    assert.equal(s.sent, 2); // applied + rejected; pending and skipped are not sent
    assert.equal(s.pending, 1);
    assert.equal(s.skipped, 1);
    assert.equal(s.response_rate, 0.5);
  });

  test("stats response rate is null rather than zero when nothing was sent", () => {
    assert.equal(JSON.parse(cli("stats").out).response_rate, null);
  });

  test("index writes the Needs you table and a month page", () => {
    add({ company: "Acme", role: "Designer", url: "https://acme.com/careers/1234567", status: "pending", notes: "tick the reCAPTCHA yourself" });
    assert.equal(cli("index").rc, 0);
    const top = fs.readFileSync(path.join(tmp, "applications", "README.md"), "utf8");
    assert.match(top, /## Needs you \(1\)/);
    assert.match(top, /tick the reCAPTCHA yourself/);
    assert.match(fs.readFileSync(path.join(tmp, "applications", TODAY.slice(0, 7), "README.md"), "utf8"), /Acme/);
  });

  test("list filters by status and date", () => {
    add({ company: "Old", role: "D", url: "https://old.com/careers/1111111", status: "applied", date: "2026-01-05", applied: "2026-01-05" });
    add({ company: "New", role: "D", url: "https://new.com/careers/2222222", status: "applied" });
    let r = cli("list", "--since", "2026-06-01");
    assert.match(r.out, /New/);
    assert.doesNotMatch(r.out, /Old/);
    r = cli("list", "--status", "pending");
    assert.equal(r.out.trim(), "");
  });

  // -- normalize --------------------------------------------------------

  test("normalize --dry-run changes nothing on disk", () => {
    const p = add({ company: "Acme", role: "Designer", url: "https://boards.greenhouse.io/acme/jobs/4567890" });
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("source: ", "source: Greenhouse"));
    const before = fs.readFileSync(p, "utf8");
    let r = cli("normalize", "--dry-run");
    assert.equal(r.rc, 0);
    assert.match(r.out, /would change/);
    assert.equal(fs.readFileSync(p, "utf8"), before);
    r = cli("normalize");
    assert.match(r.out, /normalised/);
    assert.match(fs.readFileSync(p, "utf8"), /ats: greenhouse/);
  });

  test("normalize is stable on a second pass", () => {
    // `normalize` counting work forever would mean it is rewriting files on every run,
    // which is how a hand-editable tracker drifts.
    add({ company: "Acme", role: "Designer", url: "https://jobs.lever.co/acme/1234567" });
    add({ company: "Bcme", role: "Designer", url: "https://b.com/careers/7654321", status: "skipped", notes: "pipe | in the reason" });
    cli("normalize");
    assert.equal(cli("normalize").out.trim(), "0 files and 0 skip rows normalised");
  });

  test("a skip reason containing a pipe does not grow backslashes", () => {
    add({ company: "Acme", role: "Designer", url: "https://a.com/careers/1111111", status: "skipped", notes: "country list: DE | IT | PT" });
    // A second skip in the same month rewrites the whole table.
    add({ company: "Bcme", role: "Designer", url: "https://b.com/careers/2222222", status: "skipped", notes: "sector" });
    cli("normalize");
    const table = skipsTable();
    assert.ok(table.includes("country list: DE \\| IT \\| PT"));
    assert.ok(!table.includes("\\\\|"));
  });

  test("a record written on Windows with CRLF line endings reads the same", () => {
    // Python's read_text() hid the difference; a port that did not would see no front
    // matter at all in a file written by write_text() on Windows.
    const p = add({ company: "Acme", role: "Designer", url: "https://acme.com/careers/1234567", status: "applied" });
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/\n/g, "\r\n"));
    const r = cli("check", "https://acme.com/careers/1234567");
    assert.equal(r.rc, 1);
    assert.match(r.out, /applied \| Acme \| Designer/);
  });
});

// ------------------------------------------------------------------ the sweeps

// A fake network (SEEKTER_HTTP): a module that logs each URL and answers from a table.
function fakeHttp(tmp, routes, fallback) {
  const log = path.join(tmp, "http.log");
  const mod = path.join(tmp, "fake_http.mjs");
  fs.writeFileSync(mod, `import fs from "node:fs";
const routes = ${JSON.stringify(routes)};
export default async function (url) {
  fs.appendFileSync(${JSON.stringify(log)}, url + "\\n");
  for (const [needle, body] of routes) if (url.includes(needle)) return body;
  return ${JSON.stringify(fallback)};
}
`);
  return { env: { SEEKTER_HTTP: mod }, urls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean) : []) };
}

describe("freehire sweep", () => {
  // The sweep against a throwaway repository and a fake network that logs each request and
  // answers with no jobs, so nothing touches the real one.
  let tmp, http;
  beforeEach(() => {
    tmp = makeRepo("seekter-sweep-", ["seekter.mjs", "_shared.mjs", "freehire_sweep.mjs"]);
    fs.mkdirSync(path.join(tmp, "templates"));
    fs.copyFileSync(path.join(REPO, "templates", "settings.json"), path.join(tmp, "templates", "settings.json"));
    fs.mkdirSync(path.join(tmp, "profile"));
    http = fakeHttp(tmp, [], '{"data": []}');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const sweep = (freehire) => {
    const settings = { title_keep: "designer", freehire: { queries: ["product designer"], categories: ["design"], ...freehire } };
    fs.writeFileSync(path.join(tmp, "profile", "settings.json"), JSON.stringify(settings));
    const r = runIn(tmp, "freehire_sweep.mjs", [], { env: http.env });
    return { ...r, urls: http.urls() };
  };

  test("a home country without regions sweeps by country only", () => {
    // PR #39: freehire's own region for Turkey returns 0, so a home-country-only candidate
    // sets regions to [] and must still get the countries pass.
    const { rc, err, urls } = sweep({ regions: [], home_country: "tr" });
    assert.equal(rc, 0, err);
    assert.ok(urls.length);
    assert.ok(urls.every((u) => u.includes("countries=tr")), urls.join("\n"));
    assert.ok(!urls.some((u) => u.includes("regions=")), urls.join("\n"));
  });

  test("neither regions nor a home country stops the sweep", () => {
    const { rc, err, urls } = sweep({ regions: [], home_country: "" });
    assert.notEqual(rc, 0);
    assert.match(err, /No freehire regions/);
    assert.deepEqual(urls, []);
  });
});

describe("employer sweep", () => {
  // The watchlist sweep against a throwaway repository and a fake network that answers one
  // Greenhouse board and nothing else.
  const BOARD = { jobs: [
    { id: 1, title: "Senior Product Designer", location: { name: "Remote, Europe" } },
    { id: 2, title: "Interior Designer", location: { name: "Berlin" } },
    { id: 3, title: "Backend Engineer", location: { name: "Remote" } },
    { id: 4, title: "Product Designer, Growth", location: { name: "Remote" } },
  ] };
  let tmp, http;
  beforeEach(() => {
    tmp = makeRepo("seekter-employers-", ["seekter.mjs", "_shared.mjs", "employer_sweep.mjs"]);
    fs.mkdirSync(path.join(tmp, "templates"));
    fs.copyFileSync(path.join(REPO, "templates", "settings.json"), path.join(tmp, "templates", "settings.json"));
    fs.mkdirSync(path.join(tmp, "profile"));
    http = fakeHttp(tmp, [["boards-api.greenhouse.io/v1/boards/acme/", JSON.stringify(BOARD)]], "{}");
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const sweep = (employers) => {
    fs.writeFileSync(path.join(tmp, "profile", "settings.json"), JSON.stringify({ title_keep: "designer", title_drop: "interior", employers }));
    return runIn(tmp, "employer_sweep.mjs", [], { env: http.env });
  };

  test("titles are filtered and tracked postings dropped", () => {
    const add = runIn(tmp, "seekter.mjs", ["add", "--company", "Acme", "--role", "Product Designer, Growth", "--status", "applied",
      "--url", "https://job-boards.greenhouse.io/acme/jobs/4"]);
    assert.equal(add.rc, 0, add.err);
    const r = sweep([{ name: "Acme", ats: "greenhouse", slug: "acme" }]);
    assert.equal(r.rc, 0, r.err);
    assert.match(r.out, /1 boards, 4 postings → 1 candidates/);
    assert.match(r.out, /Senior Product Designer/);
    assert.doesNotMatch(r.out, /Interior/);
    assert.doesNotMatch(r.out, /Growth/);
  });

  test("a wrong slug is reported, not guessed", () => {
    const r = sweep([{ name: "Nobody", ats: "ashby", slug: "nobody" }, { name: "Odd", ats: "taleo", slug: "odd" }]);
    assert.equal(r.rc, 0, r.err);
    assert.match(r.out, /problem: Nobody: no board at ashby:nobody/);
    assert.match(r.out, /problem: Odd: no board at taleo:odd/);
  });

  test("an empty watchlist stops the sweep", () => {
    const r = sweep([]);
    assert.notEqual(r.rc, 0);
    assert.match(r.err, /No employers/);
  });
});

// ------------------------------------------------------------------ the CV engine

describe("cv engine", async () => {
  const cv = await import("../scripts/cv.mjs");
  const example = JSON.parse(fs.readFileSync(path.join(REPO, "templates", "cv", "example.json"), "utf8"));

  test("the example renders every section in its order, with the header first", () => {
    const html = cv.renderBody(cv.mergeResume(example));
    const at = (s) => html.indexOf(s);
    assert.ok(at("Jonathan Doe") > 0 && at("Jonathan Doe") < at(">Summary<"));
    const titles = ["Summary", "Experience", "Projects", "Education", "Skills", "Certifications", "Languages"].map((t) => at(`>${t}<`));
    assert.deepEqual([...titles].sort((x, y) => x - y), titles, "sections out of order");
    assert.ok(titles.every((i) => i > 0));
  });

  test("a hidden section is left out and a section missing from the order is appended", () => {
    // seekter.dev stores the hidden sections, not the visible ones, so a resume written
    // before a section existed still shows it rather than blanking it out.
    const d = cv.mergeResume({ ...example, sectionOrder: ["experience", "summary"], hiddenSections: ["projects", "bogus"] });
    assert.deepEqual(d.sectionOrder, ["experience", "summary", "projects", "education", "skills", "certifications", "languages"]);
    assert.deepEqual(d.hiddenSections, ["projects"]);
    const html = cv.renderBody(d);
    assert.ok(!html.includes(">Projects<"));
    assert.ok(html.indexOf(">Experience<") < html.indexOf(">Summary<"));
  });

  test("dates read like the site's: month and year, an open end shows the start alone", () => {
    assert.equal(cv.formatDate("2022-03"), "Mar 2022");
    assert.equal(cv.formatDate("2023"), "2023");
    const html = cv.renderBody(cv.mergeResume({ experience: [
      { role: "A", company: "X", start: "2020-01", end: "present", bullets: [] },
      { role: "B", company: "Y", start: "2019-06", end: "2022-02", bullets: [] },
      { role: "C", company: "Z", start: "2022-03", end: "", bullets: [] }] }));
    assert.ok(html.includes("Jan 2020 - Present"));
    assert.ok(html.includes("Jun 2019 - Feb 2022"));
    assert.ok(html.includes(">Mar 2022<"));
  });

  test("text is escaped and bare URLs in running text become links", () => {
    const html = cv.renderBody(cv.mergeResume({ summary: "<b>bold</b> & co",
      experience: [{ role: "R", company: "C", bullets: ["Shipped example.com/x, then more."] }] }));
    assert.ok(html.includes("&lt;b&gt;bold&lt;/b&gt; &amp; co"));
    assert.ok(html.includes('<a class="cv-link-inline" href="https://example.com/x"'));
    assert.ok(html.includes("</a>, then more."), "trailing punctuation stays outside the link");
  });

  test("a file exported from the site's API is unwrapped, and old link fields still count", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seekter-cv-"));
    try {
      const f = path.join(tmp, "r.json");
      fs.writeFileSync(f, JSON.stringify({ resume: { title: "t", data: { header: { full_name: "N", website: "n.example.com" } } } }));
      const d = cv.loadResume(f);
      assert.equal(d.header.full_name, "N");
      assert.deepEqual(d.header.links.map((l) => l.url), ["n.example.com"]);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  test("the example prints to a PDF when a browser is installed", { skip: !hasChrome(cv) && "no Chrome, Chromium or Edge here" }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seekter-cv-pdf-"));
    try {
      const out = path.join(tmp, "example.pdf");
      const p = spawnSync(process.execPath, [path.join(SCRIPTS, "cv.mjs"), "pdf", path.join(REPO, "templates", "cv", "example.json"), "--out", out], { encoding: "utf8", timeout: 120000 });
      assert.equal(p.status, 0, p.stderr);
      assert.equal(fs.readFileSync(out).subarray(0, 5).toString(), "%PDF-");
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

function hasChrome(cv) {
  try { return fs.existsSync(cv.findChrome()); } catch { return false; }
}
