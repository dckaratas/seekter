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
  test("a LinkedIn link with a title slug keys to the same id as the bare one", () => {
    // Share links and alert mails write /jobs/view/<title>-<id>; before 22 Oct 2026 that form got
    // a path key, and samePosting never compares prefixed keys, so the two looked like two jobs.
    for (const u of ["https://www.linkedin.com/jobs/view/senior-product-designer-at-acme-4001234567/",
      "https://tr.linkedin.com/jobs/view/senior-product-designer-at-acme-4001234567?trk=public_jobs",
      "https://www.linkedin.com/jobs/view/4001234567", "https://www.linkedin.com/jobs/search/?currentJobId=4001234567"]) {
      assert.equal(sk.jobKey(u), "linkedin:4001234567", u);
    }
  });

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
    assert.equal(sk.jobKey("http://user:pw@Example.COM:8080/a/b/"), "user:pw@example.com:8080/a/b");
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
  // The employer sweep reads one file per application system from scripts/providers/.
  if (scripts.includes("employer_sweep.mjs") || scripts.includes("live.mjs")) fs.cpSync(path.join(SCRIPTS, "providers"), path.join(tmp, "scripts", "providers"), { recursive: true });
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
    assert.match(r.out, /no resume yet/);
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

  test("check catches the same posting under a shortened URL or the same posting id", () => {
    add({ company: "Medco", role: "Senior UI Designer", status: "pending",
      url: "https://careers.medco.example/global/en/job/P-100931/Senior-UI-Designer-for-medical-software-products" });
    add({ company: "Wdco", role: "Lead Product Designer", status: "applied",
      url: "https://wdco.wd5.myworkdayjobs.com/en-US/External/job/Hungary--Budapest/Lead-Product-Designer_261413-1" });
    // The slug cut short by whoever passed the link on.
    let r = cli("check", "https://careers.medco.example/global/en/job/P-100931/Senior-UI-Designer-for-medical-software-");
    assert.equal(r.rc, 1);
    assert.match(r.out, /DUPLICATE: .*same posting under another URL: a shortened copy/);
    // The same requisition id behind a different path.
    r = cli("check", "https://wdco.wd5.myworkdayjobs.com/External/job/Budapest/Lead-Product-Designer_261413-1/apply");
    assert.equal(r.rc, 1);
    assert.match(r.out, /the same posting id \(261413\)/);
    // A different id on the same site is a different posting.
    assert.equal(cli("check", "https://careers.medco.example/global/en/job/P-100932/Senior-UI-Designer").rc, 0);
    r = cliIn("https://careers.medco.example/global/en/job/P-100931/Senior-UI-Designer-for-medical\n", "check-many");
    assert.match(r.out, /^DUP .*a shortened copy/m);
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

  test("stats --by groups sent applications and counts an interview the log remembers", () => {
    add({ company: "A", role: "Senior Product Designer (Growth)", url: "https://a.com/careers/1111111", status: "applied", ats: "ashby" });
    add({ company: "B", role: "Product Designer - AI", url: "https://b.com/careers/2222222", status: "applied", ats: "ashby" });
    add({ company: "C", role: "UX Designer", url: "https://c.com/careers/3333333", status: "rejected", ats: "lever" });
    add({ company: "D", role: "Product Designer", url: "https://d.com/careers/4444444", status: "skipped", notes: "sector" });
    assert.equal(cli("move", "https://b.com/careers/2222222", "interviewing").rc, 0);
    assert.equal(cli("move", "https://b.com/careers/2222222", "rejected").rc, 0);
    let r = cli("stats", "--by", "ats", "--floor", "1");
    assert.equal(r.rc, 0);
    // A is still waiting: in flight, and in no rate. B reached an interview and was rejected.
    assert.match(r.out, /\| ashby \| 2 \| 1 \| 1 \| 100% \| 1 \| 100% \|/);
    assert.match(r.out, /\| lever \| 1 \| 0 \| 1 \| 100% \| 0 \| 0% \|/);
    assert.match(r.out, /\| \*\*all\*\* \| 3 \| 1 \| 2 \| 100% \| 1 \| 50% \|/); // the skip is not sent
    // Below the default floor of 5 decided applications a row gives counts and no rate.
    r = cli("stats", "--by", "ats");
    assert.match(r.out, /\| ashby \| 2 \| 1 \| 1 \| n<5 \| 1 \| n<5 \|/);
    assert.match(r.out, /no comparison/);
    r = cli("stats", "--by", "title,seniority");
    assert.match(r.out, /\| product designer · senior \| 1 \|/);
    assert.match(r.out, /\| product designer · none \| 1 \|/);
  });

  // Posting text in a quoted shell argument runs whatever $(...) or backtick it holds, so every
  // command also reads its arguments from a JSON file the agent writes with its file tool.
  test("--json takes every argument from a file and stores hostile text verbatim", () => {
    const j = (name, obj) => { const f = path.join(tmp, name); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
    const role = "Designer $(touch pwned) `id` \"quoted\"";
    const r = cli("add", "--json", j("a.json", { company: "Acme", role, status: "applied", url: "https://jobs.example.com/acme/123456",
      fit: 4, answers: "It's $HOME; keep it", no_index: true }));
    assert.equal(r.rc, 0, r.err);
    const file = path.join(tmp, r.out.trim());
    const text = fs.readFileSync(file, "utf8");
    assert.ok(text.includes(`role: ${role}`) || text.includes(role), text);
    assert.ok(text.includes("It's $HOME; keep it"));
    assert.ok(!fs.existsSync(path.join(tmp, "pwned")));
    assert.equal(cli("check", "--json", j("c.json", { url: "https://jobs.example.com/acme/123456", company: "Acme" })).rc, 1);
    const m = cli("move", "--json", j("m.json", { target: file, status: "rejected", note: "said \"no\" $(whoami)" }));
    assert.equal(m.rc, 0, m.err);
    assert.match(fs.readFileSync(file, "utf8"), /rejected\. said "no" \$\(whoami\)/);
  });

  test("--json refuses unknown fields, broken JSON and positionals on the command line", () => {
    const f = path.join(tmp, "x.json");
    fs.writeFileSync(f, JSON.stringify({ company: "A", role: "B", colour: "red" }));
    assert.match(cli("add", "--json", f).err, /unknown field "colour"/);
    fs.writeFileSync(f, "{not json");
    assert.match(cli("add", "--json", f).err, /not valid JSON/);
    fs.writeFileSync(f, JSON.stringify({ status: "rejected" }));
    assert.equal(cli("move", "somefile.md", "--json", f).rc, 2);
  });

  test("--json reads a file that starts with a UTF-8 byte-order mark", () => {
    // Windows PowerShell 5.1's Set-Content -Encoding utf8 writes one.
    const f = path.join(tmp, "bom.json");
    fs.writeFileSync(f, "\uFEFF" + JSON.stringify({ company: "Acme", role: "Dev", status: "skipped", url: "https://jobs.example.com/acme/777777", no_index: true }));
    const r = cli("add", "--json", f);
    assert.equal(r.rc, 0, r.err);
  });

  test("add takes a fit score from 1 to 5 and refuses anything else", () => {
    add({ company: "A", role: "D", url: "https://a.com/careers/1111111", status: "applied", fit: "4" });
    for (const bad of ["8", "0", "3.5", "good fit"]) {
      const r = cli("add", "--company", "B", "--role", "D", "--url", "https://b.com/careers/2222222", "--status", "applied", "--fit", bad);
      assert.equal(r.rc, 1, bad);
      assert.match(r.err, /fit must be a whole number from 1 to 5/);
    }
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

  test("each application system reads its own public board", () => {
    const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel>
      <item><title>Senior Product Designer</title><link>https://jobs.tt-co.example/jobs/1-senior-product-designer</link><remoteStatus>hybrid</remoteStatus>
      <tt:locations><tt:location><tt:name>Copenhagen, Denmark</tt:name></tt:location></tt:locations></item>
      <item><title>Accountant</title><link>https://jobs.tt-co.example/jobs/2-accountant</link><remoteStatus>none</remoteStatus></item>
      </channel></rss>`;
    const xml = `<?xml version="1.0"?><workzag-jobs><position><id>77</id><office>Berlin</office><additionalOffice>Remote</additionalOffice>
      <name>Product Designer &amp; Researcher</name></position></workzag-jobs>`;
    http = fakeHttp(tmp, [
      ["api.smartrecruiters.com/v1/companies/SrCo/postings", JSON.stringify({ totalFound: 1, content: [{ id: "744", name: "Product Designer ", location: { city: "Munich", country: "de", remote: true } }] })],
      ["srco.recruitee.com/api/offers", JSON.stringify({ offers: [{ title: "UX Designer", location: "Amsterdam", remote: false, careers_url: "https://srco.recruitee.com/o/ux-designer" }] })],
      ["pco.jobs.personio.de/xml", xml],
      ["jobs.tt-co.example/jobs.rss", rss],
      ["wdco.wd3.myworkdayjobs.com/wday/cxs/wdco/External/jobs", JSON.stringify({ total: 1, jobPostings: [{ title: "Lead Product Designer", locationsText: "Hungary > Budapest", remoteType: "Hybrid", externalPath: "/job/Budapest/Lead-Product-Designer_1" }] })],
    ], "{}");
    const r = sweep([
      { name: "Sr", ats: "smartrecruiters", slug: "SrCo" }, { name: "Re", ats: "recruitee", slug: "srco" },
      { name: "Pe", ats: "personio", slug: "pco" }, { name: "Tt", ats: "teamtailor", slug: "jobs.tt-co.example" },
      { name: "Wd", ats: "workday", slug: "wdco.wd3/External" }]);
    assert.equal(r.rc, 0, r.err);
    assert.match(r.out, /5 boards, 6 postings → 5 candidates/);
    assert.match(r.out, /Sr \| Product Designer \| Munich DE remote \| https:\/\/jobs\.smartrecruiters\.com\/SrCo\/744/);
    assert.match(r.out, /Re \| UX Designer \| Amsterdam \| https:\/\/srco\.recruitee\.com\/o\/ux-designer/);
    assert.match(r.out, /Pe \| Product Designer & Researcher \| Berlin \/ Remote \| https:\/\/pco\.jobs\.personio\.de\/job\/77/);
    assert.match(r.out, /Tt \| Senior Product Designer \| Copenhagen, Denmark \/ remote: hybrid/);
    assert.match(r.out, /Wd \| Lead Product Designer \| Hungary > Budapest · Hybrid \| https:\/\/wdco\.wd3\.myworkdayjobs\.com\/en-US\/External\/job\/Budapest\/Lead-Product-Designer_1/);
    assert.doesNotMatch(r.out, /Accountant/);
    assert.doesNotMatch(r.out, /problem:/);
  });

  test("a Workday slug in the wrong shape is reported, not fetched", () => {
    const r = sweep([{ name: "Wd", ats: "workday", slug: "https://wdco.wd3.myworkdayjobs.com/External" }]);
    assert.match(r.out, /problem: Wd: no board at workday:/);
    assert.ok(!http.urls().some((u) => u.includes("myworkdayjobs")));
  });

  test("an empty watchlist stops the sweep", () => {
    const r = sweep([]);
    assert.notEqual(r.rc, 0);
    assert.match(r.err, /No employers/);
  });
});

describe("live check", () => {
  // Each system's own answer for one posting, from a fake network that also gives status codes.
  let tmp, http;
  beforeEach(() => {
    tmp = makeRepo("seekter-live-", ["seekter.mjs", "_shared.mjs", "live.mjs"]);
    http = fakeHttp(tmp, [
      ["boards-api.greenhouse.io/v1/boards/acme/jobs/111", { status: 200, body: '{"id":111}' }],
      ["boards-api.greenhouse.io/v1/boards/acme/jobs/222", { status: 404, body: '{"status":404,"error":"Job not found"}' }],
      ["jobs.ashbyhq.com/acme/11111111-1111-1111-1111-111111111111", { status: 200, body: 'x "posting":{"id":"11111111"} x' }],
      ["jobs.ashbyhq.com/acme/22222222-2222-2222-2222-222222222222", { status: 200, body: 'x "posting":null x' }],
      ["jobs.acme.example/jobs.rss", '<?xml version="1.0"?><rss version="2.0"></rss>'],
      ["jobs.acme.example/jobs/9-gone", { status: 404, body: "" }],
      ["careers.other.example/jobs/9-gone", { status: 404, body: "" }],
    ], { status: 500, body: "" });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test("open, closed and unknown come from the posting's own system, never from LinkedIn", () => {
    const r = runIn(tmp, "live.mjs", [
      "https://job-boards.greenhouse.io/acme/jobs/111", "https://job-boards.greenhouse.io/acme/jobs/222",
      "https://jobs.ashbyhq.com/acme/11111111-1111-1111-1111-111111111111", "https://jobs.ashbyhq.com/acme/22222222-2222-2222-2222-222222222222",
      "https://jobs.acme.example/jobs/9-gone", "https://careers.other.example/jobs/9-gone",
      "https://www.linkedin.com/jobs/view/4001234567/"], { env: http.env });
    assert.equal(r.rc, 0, r.err);
    assert.match(r.out, /^OPEN +https:\/\/job-boards\.greenhouse\.io\/acme\/jobs\/111 +\(greenhouse\)/m);
    assert.match(r.out, /^CLOSED +https:\/\/job-boards\.greenhouse\.io\/acme\/jobs\/222/m);
    assert.match(r.out, /^OPEN +https:\/\/jobs\.ashbyhq\.com\/acme\/1111/m);
    assert.match(r.out, /^CLOSED +https:\/\/jobs\.ashbyhq\.com\/acme\/2222/m);
    assert.match(r.out, /^CLOSED +https:\/\/jobs\.acme\.example\/jobs\/9-gone +\(teamtailor\)/m);
    // A 404 on a site that is not Teamtailor says nothing, so it stays unknown.
    assert.match(r.out, /^UNKNOWN +https:\/\/careers\.other\.example/m);
    assert.match(r.out, /^UNKNOWN +https:\/\/www\.linkedin\.com.*never called/m);
    assert.ok(!http.urls().some((u) => u.includes("linkedin")));
  });

  // Signals a bare 200 or 404 misses: a confidential Lever posting 404s on the public API while
  // open, a SmartRecruiters posting can answer 200 inactive, a withdrawn Workday posting 403s
  // with S22, and a Workable job carries its state.
  test("each system's own closed signal decides, and a bare 404 on Lever asks the job page", () => {
    const L = "33333333-3333-3333-3333-333333333333", G = "44444444-4444-4444-4444-444444444444";
    const net = fakeHttp(tmp, [
      [`api.lever.co/v0/postings/acme/${L}`, { status: 404, body: '{"ok":false}' }],
      [`jobs.lever.co/acme/${L}`, { status: 200, body: "<html>apply</html>" }],
      [`api.lever.co/v0/postings/acme/${G}`, { status: 404, body: '{"ok":false}' }],
      [`jobs.lever.co/acme/${G}`, { status: 404, body: "" }],
      ["companies/Acme1/postings/111", { status: 200, body: '{"id":"111","active":false}' }],
      ["companies/Acme1/postings/222", { status: 200, body: '{"id":"222","active":true}' }],
      ["/wday/cxs/acme/External/job/Berlin/Designer_R1", { status: 403, body: '{"errorCode":"S22","httpStatus":403}' }],
      ["/wday/cxs/acme/External/job/Berlin/Designer_R2", { status: 403, body: '{"errorCode":"S99"}' }],
      ["api/v2/accounts/acme/jobs/AAA111", { status: 200, body: '{"state":"archived"}' }],
      ["api/v2/accounts/acme/jobs/BBB222", { status: 200, body: '{"state":"published"}' }],
    ], { status: 500, body: "" });
    const r = runIn(tmp, "live.mjs", [
      `https://jobs.lever.co/acme/${L}`, `https://jobs.lever.co/acme/${G}`,
      "https://jobs.smartrecruiters.com/Acme1/111-designer", "https://jobs.smartrecruiters.com/Acme1/222-designer",
      "https://acme.wd3.myworkdayjobs.com/External/job/Berlin/Designer_R1", "https://acme.wd3.myworkdayjobs.com/External/job/Berlin/Designer_R2",
      "https://apply.workable.com/acme/j/AAA111", "https://apply.workable.com/acme/j/BBB222"], { env: net.env });
    assert.equal(r.rc, 0, r.err);
    assert.match(r.out, new RegExp(`^OPEN +https://jobs\\.lever\\.co/acme/${L} +\\(lever\\)`, "m"));
    assert.match(r.out, new RegExp(`^CLOSED +https://jobs\\.lever\\.co/acme/${G}`, "m"));
    assert.match(r.out, /^CLOSED +https:\/\/jobs\.smartrecruiters\.com\/Acme1\/111/m);
    assert.match(r.out, /^OPEN +https:\/\/jobs\.smartrecruiters\.com\/Acme1\/222/m);
    assert.match(r.out, /^CLOSED +https:\/\/acme\.wd3\.myworkdayjobs\.com\/External\/job\/Berlin\/Designer_R1/m);
    assert.match(r.out, /^UNKNOWN +https:\/\/acme\.wd3\.myworkdayjobs\.com\/External\/job\/Berlin\/Designer_R2/m);
    assert.match(r.out, /^CLOSED +https:\/\/apply\.workable\.com\/acme\/j\/AAA111/m);
    assert.match(r.out, /^OPEN +https:\/\/apply\.workable\.com\/acme\/j\/BBB222/m);
  });

  test("a single closed posting exits 3", () => {
    assert.equal(runIn(tmp, "live.mjs", ["https://job-boards.greenhouse.io/acme/jobs/222"], { env: http.env }).rc, 3);
  });
});

// ------------------------------------------------------------- the npm package

describe("npx seekter init", () => {
  let tmp;
  const BIN = path.join(REPO, "npm", "bin", "seekter.mjs");
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seekter-npm-")); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const run = (...args) => {
    const p = spawnSync(process.execPath, [BIN, ...args], { cwd: tmp, encoding: "utf8" });
    return { rc: p.status, out: p.stdout, err: p.stderr };
  };
  // A release archive the way GitHub serves one: everything under one owner-repo-sha folder.
  const archive = (files) => {
    const src = path.join(tmp, "src"), top = path.join(src, "selfishprimate-seekter-abc1234");
    for (const [f, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(top, f)), { recursive: true });
      fs.writeFileSync(path.join(top, f), text);
    }
    // Written from stdout with the source as the working directory, so no drive-letter path reaches tar.
    const out = path.join(tmp, "release.tar.gz");
    const p = spawnSync("tar", ["-czf", "-", "selfishprimate-seekter-abc1234"], { cwd: src, maxBuffer: 1 << 26 });
    assert.equal(p.status, 0, String(p.stderr));
    fs.writeFileSync(out, p.stdout);
    fs.rmSync(src, { recursive: true, force: true });
    return out;
  };
  const KIT = { ".claude/skills/seekter-run/SKILL.md": "run", "scripts/seekter.mjs": "//", "profile/.gitkeep": "",
    "applications/.gitkeep": "", "runs/.gitkeep": "", "DISCLAIMER.md": "yours" };

  test("unpacks a release into a new folder, straight under it, with the private folders ready", () => {
    const r = run("init", "search", "--from", archive(KIT));
    assert.equal(r.rc, 0, r.err);
    const dir = path.join(tmp, "search");
    assert.ok(fs.existsSync(path.join(dir, ".claude", "skills", "seekter-run", "SKILL.md")));
    for (const p of ["profile", "applications", "runs"]) assert.ok(fs.statSync(path.join(dir, p)).isDirectory());
    assert.match(r.out, /responsible for what they say/);
    assert.match(r.out, /\/seekter-init/);
  });

  test("never writes into a folder that already holds something", () => {
    const dir = path.join(tmp, "search");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "cv.pdf"), "mine");
    const r = run("init", "search", "--from", archive(KIT));
    assert.equal(r.rc, 1);
    assert.match(r.err, /not empty/);
    assert.deepEqual(fs.readdirSync(dir), ["cv.pdf"]);
  });

  test("refuses an archive that carries anything under a private folder, and leaves nothing behind", () => {
    const r = run("init", "search", "--from", archive({ ...KIT, "profile/profile.md": "a candidate" }));
    assert.equal(r.rc, 1);
    assert.match(r.err, /under profile\//);
    assert.ok(!fs.existsSync(path.join(tmp, "search")));
  });

  test("refuses an archive that is not a Seekter release", () => {
    const r = run("init", "search", "--from", archive({ "README.md": "something else" }));
    assert.equal(r.rc, 1);
    assert.match(r.err, /does not look like a Seekter release/);
  });

  test("prints its version and usage, and rejects what it does not know", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "npm", "package.json"), "utf8"));
    assert.equal(run("--version").out.trim(), pkg.version);
    assert.equal(run().rc, 2);
    assert.equal(run("deploy").rc, 2);
    assert.equal(run("init", "--bogus").rc, 2);
  });

  test("the npm README is the repository's, with every link and image made absolute", async () => {
    // npm shows the README packed into the latest version and resolves nothing relative to the repo.
    const { npmReadme } = await import("../npm/sync-readme.mjs");
    const out = npmReadme('<img src="images/cover.jpg">\n\n# Seekter\n\n[![version](https://img.shields.io/x)](https://x)\n\nSee [the manifesto](MANIFESTO.md), ![pic](./images/a.png), [top](#install), [site](https://seekter.dev).\n\n> [!IMPORTANT]\n> Read this.\n');
    assert.match(out, /src="https:\/\/raw\.githubusercontent\.com\/selfishprimate\/seekter\/main\/images\/cover\.jpg"/);
    assert.match(out, /\(https:\/\/github\.com\/selfishprimate\/seekter\/blob\/main\/MANIFESTO\.md\)/);
    assert.match(out, /!\[pic\]\(https:\/\/raw\.githubusercontent\.com\/selfishprimate\/seekter\/main\/images\/a\.png\)/);
    assert.match(out, /\(#install\)/);
    assert.match(out, /\(https:\/\/seekter\.dev\)/);
    assert.doesNotMatch(out, /\[!IMPORTANT\]/);
    assert.ok(out.indexOf("This package installs Seekter") > out.indexOf("[![version]"), "the note sits under the title block");
    // The README shipped in npm/ is the generated one, so a publish never carries a stale copy.
    // Compared with LF line endings: a Windows checkout turns both files into CRLF.
    const lf = (t) => t.replace(/\r\n/g, "\n");
    const shipped = lf(fs.readFileSync(path.join(REPO, "npm", "README.md"), "utf8"));
    assert.equal(shipped, npmReadme(fs.readFileSync(path.join(REPO, "README.md"), "utf8")), "run node npm/sync-readme.mjs");
    assert.equal(npmReadme(lf(fs.readFileSync(path.join(REPO, "README.md"), "utf8")).replace(/\n/g, "\r\n")), shipped, "CRLF input gives the same page");
  });

  test("the package ships only its own files and depends on nothing", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "npm", "package.json"), "utf8"));
    assert.equal(pkg.name, "seekter");
    assert.deepEqual(pkg.bin, { seekter: "bin/seekter.mjs" });
    assert.ok(!pkg.dependencies && !pkg.scripts, "no dependencies and no install scripts");
    assert.deepEqual(pkg.files, ["bin/seekter.mjs", "README.md"]);
  });
});

// ----------------------------------------------------------- what a form receives

describe("answer check", () => {
  let tmp;
  const PROFILE = [
    "# Candidate profile", "",
    "## 1. Identity and contact", "", "| Name | Jo Example |", "",
    "## 3. Standard answers", "", "| Work authorisation | I can work as a contractor from my home country without sponsorship. |", "",
    "## 4. Salary bands", "", "| Europe | EUR 4,500-6,000 / month |", "",
    "## 8. Fact bank", "", "- Built a design system of 870 tokens and 50+ components, used by four products.",
    "- Cut checkout steps from 7 to 3. Stories are in `profile/stories.md`.", "",
    "## 9. Voice", "", "- **Banned phrases:** passionate about · leverage · end to end / end-to-end.", "",
    "## 10. Search configuration", "", "- 12 searches a run, 40 details.", "",
  ].join("\n");
  beforeEach(() => {
    tmp = makeRepo("seekter-claims-", ["seekter.mjs", "resume.mjs", "claims.mjs"]);
    fs.mkdirSync(path.join(tmp, "profile"));
    fs.writeFileSync(path.join(tmp, "profile", "profile.md"), PROFILE);
    fs.writeFileSync(path.join(tmp, "profile", "stories.md"), "Mobile web was 80% of traffic, the app 9%.");
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const check = (text, ...args) => {
    fs.writeFileSync(path.join(tmp, "answer.txt"), text);
    return runIn(tmp, "claims.mjs", [path.join(tmp, "answer.txt"), ...args]);
  };

  test("a number from the fact bank or a file it names passes; an invented one does not", () => {
    const ok = check("I built 870 tokens and 50+ components. Mobile web was 80% of traffic.");
    assert.equal(ok.rc, 0, ok.out);
    const bad = check("I grew conversion by 40% and led 12 designers.");
    assert.equal(bad.rc, 1);
    assert.match(bad.out, /number .*"40%"/);
    // 12 and 40 are in the profile, but in its search settings, which are not facts.
    assert.match(bad.out, /number .*"12"/);
  });

  test("dates, years, links, salary answers and the posting's own numbers are not claims", () => {
    const text = "Available from 3 Nov 2026, or 2026-11-03 at 10:00. Since 2015. See https://example.com/job/123456. " +
      "Salary: EUR 64,000 gross per year (GBP 3,700 a month), or 50,000 to 58,000 euros. The 5-minute video and your 250 stores.";
    const without = check(text);
    assert.equal(without.rc, 1);
    assert.match(without.out, /"250"/);
    fs.writeFileSync(path.join(tmp, "posting.txt"), "We run 250 stores across Europe.");
    const r = check(text, "--posting", path.join(tmp, "posting.txt"));
    assert.equal(r.rc, 0, r.out);
  });

  test("a money figure outside a salary answer is a claim, magnitude and all", () => {
    // The first version skipped every amount with a currency, so "$2M → $5M" passed as a salary.
    const r = check("We grew revenue from $2M to $5M and saved EUR 40,000 a year. Salary: EUR 64,000 gross.");
    assert.equal(r.rc, 1);
    assert.match(r.out, /"2M"/);
    assert.match(r.out, /"5M"/);
    assert.match(r.out, /"40,000"/);
    assert.doesNotMatch(r.out, /"64,000"/);
    // A question and its answer are one field, so the answer after "salary expectations?" is salary.
    assert.equal(check("What are your salary expectations? -> 64000 (EUR annual).").rc, 0);
  });

  test("banned phrases and long dashes are flagged", () => {
    const r = check("I am passionate about tokens \u2014 and I own them end-to-end.");
    assert.equal(r.rc, 1);
    assert.match(r.out, /uses "passionate about"/);
    assert.match(r.out, /uses "end-to-end"/);
    assert.match(r.out, /a long dash/);
  });

  test("a sentence already sent to another company is a repeat, unless it is the profile's own", () => {
    const sent = "The first week decides whether a new user stays, so I would start with the onboarding flow.";
    const add = runIn(tmp, "seekter.mjs", ["add", "--company", "Acme", "--role", "Designer", "--url", "https://jobs.example.com/acme/1",
      "--answers", sent, "--no-index"]);
    assert.equal(add.rc, 0, add.err);
    const r = check(`${sent} I can work as a contractor from my home country without sponsorship.`);
    assert.equal(r.rc, 1);
    assert.match(r.out, /repeat .*sent before to Acme/);
    assert.equal((r.out.match(/repeat/g) || []).length, 1, "the standard answer from the profile is meant to repeat");
    // Checking the answers of the same posting again is not a repeat.
    assert.equal(check(sent, "--url", "https://jobs.example.com/acme/1").rc, 0);
    // A prep text is not sent anywhere, so it may reuse what the application said.
    assert.equal(check(sent, "--no-repeat").rc, 0);
  });
});

// ------------------------------------------------------------------ the CV engine

describe("resume engine", async () => {
  const cv = await import("../scripts/resume.mjs"); // the resume engine
  const example = JSON.parse(fs.readFileSync(path.join(REPO, "templates", "resume", "example.json"), "utf8"));

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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seekter-resume-"));
    try {
      const f = path.join(tmp, "r.json");
      fs.writeFileSync(f, JSON.stringify({ resume: { title: "t", data: { header: { full_name: "N", website: "n.example.com" } } } }));
      const d = cv.loadResume(f);
      assert.equal(d.header.full_name, "N");
      assert.deepEqual(d.header.links.map((l) => l.url), ["n.example.com"]);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  test("the example prints to a PDF when a browser is installed", { skip: !hasChrome(cv) && "no Chrome, Chromium or Edge here" }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seekter-resume-pdf-"));
    try {
      const out = path.join(tmp, "example.pdf");
      const p = spawnSync(process.execPath, [path.join(SCRIPTS, "resume.mjs"), "pdf", path.join(REPO, "templates", "resume", "example.json"), "--out", out], { encoding: "utf8", timeout: 120000 });
      assert.equal(p.status, 0, p.stderr);
      assert.equal(fs.readFileSync(out).subarray(0, 5).toString(), "%PDF-");
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

function hasChrome(cv) {
  try { return fs.existsSync(cv.findChrome()); } catch { return false; }
}

describe("master resume and its types", async () => {
  const cv = await import("../scripts/resume.mjs"); // the resume engine
  // A fictional master: one job with a tagged pool, two types that pick differently.
  const master = () => ({
    header: { full_name: "Jo Doe", location: "Berlin", email: "jo@example.com", links: [] },
    experience: [
      { id: "acme", company: "Acme", role: "Product Designer", start: "2024-01", end: "present", description: "A logistics tool.",
        bullets: [
          { id: "flow", text: "Redesigned the booking flow.", tags: ["product", "ui"] },
          { id: "tokens", text: "Built the token pipeline.", tags: ["design-system", "engineering"] },
          { id: "study", text: "Ran 12 interviews.", tags: ["research"] },
          { id: "new", text: "A sentence nobody approved.", tags: ["design-system"], draft: true }] },
      { id: "old", company: "Oldco", role: "Web Designer", start: "2015-01", end: "2017-06", description: "News site.",
        bullets: [{ id: "a", text: "Built pages.", tags: ["ui"] }] }],
    projects: [{ id: "p1", name: "Kit", description: "A kit." }, { id: "p2", name: "Lib", description: "A lib." }],
    skills: [{ id: "s1", group: "Design", items: ["Figma"] }, { id: "s2", group: "Code", items: ["React"] }],
    variants: {
      product: { role: "Product Designer", summary: "Ships products.", tags: ["product", "research"], bullets_per_job: 2,
        older: [{ before: "2020-01", bullets: 0 }], projects: ["p2"], skills: ["s1"] },
      systems: { role: "Design System Designer", summary: "Builds systems.", tags: ["design-system"], bullets_per_job: 3 },
      picked: { role: "X", summary: "Y", bullets: { acme: ["study", "flow"] }, drop: ["old"] },
    },
  });

  test("a type picks the pool's bullets by its tags, most relevant first, and caps older jobs", () => {
    const d = cv.buildVariant(master(), "product");
    assert.equal(d.header.role, "Product Designer");
    assert.deepEqual(d.experience[0].bullets.map((b) => b.text), ["Redesigned the booking flow.", "Ran 12 interviews."]);
    assert.deepEqual(d.experience[1].bullets, [], "jobs before 2020 keep their line but no bullets");
    assert.deepEqual(d.projects.map((p) => p.name), ["Lib"]);
    assert.deepEqual(d.skills.map((s) => s.group), ["Design"]);
  });

  test("explicit picks win, in the order given, and a dropped job is gone", () => {
    const d = cv.buildVariant(master(), "picked");
    assert.deepEqual(d.experience.map((e) => e.company), ["Acme"]);
    assert.deepEqual(d.experience[0].bullets.map((b) => b.text), ["Ran 12 interviews.", "Redesigned the booking flow."]);
  });

  test("a draft bullet is reported, and the PDF refuses it without --drafts", () => {
    assert.deepEqual(cv.draftsIn(master(), "systems"), ["Acme: new"]);
    assert.deepEqual(cv.draftsIn(master(), "product"), []);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seekter-resume-master-"));
    try {
      const f = path.join(tmp, "cv.json");
      fs.writeFileSync(f, JSON.stringify(master()));
      const p = spawnSync(process.execPath, [path.join(SCRIPTS, "resume.mjs"), "pdf", f, "--variant", "systems", "--out", path.join(tmp, "x.pdf")], { encoding: "utf8" });
      assert.equal(p.status, 1);
      assert.match(p.stderr, /draft\(s\) not yet approved/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  test("validate finds unbacked numbers, dates that disagree with the profile, banned phrases and bad picks", () => {
    const m = master();
    m.experience[0].bullets[0].text = "Redesigned the booking flow end to end, cutting drop-off by 40%.";
    m.variants.picked.bullets.acme.push("ghost");
    const profile = "## 8. Fact bank\n\n| Company | Title | Dates |\n|---|---|---|\n| Acme | Product Designer | Jan 2024 – Mar 2026 |\n" +
      "| Oldco | Web Designer | Jan 2015 – Jun 2017 |\n\nFacts:\n- Ran 12 interviews at Acme.\n\n- **Banned phrases:** end to end / end-to-end · leverage · not just X but Y.\n";
    const { problems, checks } = cv.validate(m, profile);
    assert.ok(problems.some((p) => /picked: Acme has no bullet "ghost"/.test(p)), problems.join("\n"));
    assert.ok(checks.some((c) => /"40%" is not in the profile's facts/.test(c)), checks.join("\n"));
    assert.ok(!checks.some((c) => /"12"/.test(c)), "a number the profile has is fine");
    assert.ok(checks.some((c) => /Acme: ends present here, 2026-03 in the profile/.test(c)), checks.join("\n"));
    assert.ok(checks.some((c) => /uses "end to end"/.test(c)), checks.join("\n"));
    assert.ok(checks.some((c) => /systems: prints 1 draft/.test(c)), checks.join("\n"));
  });
});

describe("fitting a resume type on two pages", async () => {
  const cv = await import("../scripts/resume.mjs"); // the resume engine
  const m = () => ({
    header: { full_name: "Jo", location: "Berlin", links: [{ label: "Portfolio", url: "jo.example.com" }] },
    experience: [
      { id: "new", company: "Newco", role: "Lead", start: "2025-01", end: "present", description: "A long description of Newco.", short_description: "Newco makes things.", short_description_draft: true,
        bullets: [{ id: "a", text: "A long version of the first bullet.", short: "First, short.", short_draft: true, tags: ["product"] },
          { id: "b", text: "Second.", tags: ["product"] }] },
      { id: "mid", company: "Midco", role: "Designer", start: "2016-03", end: "2018-02", bullets: [{ id: "c", text: "Old.", tags: ["product"] }] },
      { id: "old", company: "Oldco", role: "Web Designer", start: "2012-01", end: "2016-02", bullets: [] }],
    skills: [{ id: "s", group: "Design", items: ["A", "B", "C", "D"] }],
    variants: { t: { role: "Lead", summary: "S.", short: true, tags: ["product"], bullets_per_job: 2, earlier: { before: "2017-01" },
      skill_items: 2, caps: { new: 1 }, layout: "compact" } },
  });

  test("short texts print in place of the long ones and count as drafts until approved", () => {
    const d = cv.buildVariant(m(), "t");
    assert.equal(d.experience[0].description, "Newco makes things.");
    assert.deepEqual(d.experience[0].bullets.map((b) => b.text), ["First, short."], "caps limits Newco to one bullet");
    assert.deepEqual(cv.draftsIn(m(), "t"), ["Newco: a", "Newco: short description"]);
  });

  test("older jobs fold into one Earlier experience line", () => {
    const d = cv.buildVariant(m(), "t");
    const last = d.experience[d.experience.length - 1];
    assert.equal(last.role, "Earlier experience");
    assert.match(last.description, /Designer, Midco \(Mar 2016 - Feb 2018\) · Web Designer, Oldco \(Jan 2012 - Feb 2016\)/);
    assert.equal(d.experience.length, 2);
  });

  test("skill lists are capped and the compact layout is marked", () => {
    const d = cv.buildVariant(m(), "t");
    assert.deepEqual(d.skills[0].items, ["A", "B"]);
    assert.match(cv.renderBody(d), /class="cv-root cv-compact"/);
  });

  test("projects print newest first whatever order the type lists them in", () => {
    const d = cv.buildVariant({ projects: [{ id: "old", name: "Old", start: "2018" }, { id: "new", name: "New", start: "2026" }, { id: "mid", name: "Mid", start: "2025" }],
      variants: { t: { projects: ["old", "new", "mid"] } } }, "t");
    assert.deepEqual(d.projects.map((p) => p.name), ["New", "Mid", "Old"]);
  });

  test("the kit's static Inter is inlined and no web font is fetched", () => {
    const html = cv.renderHtml(cv.mergeResume({}));
    assert.equal((html.match(/@font-face/g) || []).length, 8, "four weights, latin and latin-ext");
    assert.ok(!html.includes("fonts.googleapis.com"));
  });

  test("the ATS check flags Type 3 fonts, a missing text layer and a file over 2.5 MB", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seekter-resume-ats-"));
    const write = (name, body) => { const f = path.join(tmp, name); fs.writeFileSync(f, body, "latin1"); return f; };
    try {
      assert.deepEqual(cv.atsProblems(write("ok.pdf", "<< /Type /Font /Subtype /Type0 >>")), []);
      assert.match(cv.atsProblems(write("t3.pdf", "<< /Type /Font /Subtype /Type3 >>"))[0], /Type 3/);
      assert.match(cv.atsProblems(write("img.pdf", "<< /Type /XObject /Subtype /Image >>"))[0], /no text layer/);
      assert.match(cv.atsProblems(write("big.pdf", "<< /Type /Font /Subtype /Type0 >>" + " ".repeat(3 * 1024 * 1024)))[0], /2\.5 MB/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  test("Next.js is a name, not a link", () => {
    const html = cv.renderBody(cv.mergeResume({ experience: [{ role: "R", company: "C", bullets: ["Built it on Next.js and see example.com/x."] }] }));
    assert.ok(!html.includes('href="https://Next.js"'));
    assert.ok(html.includes('href="https://example.com/x"'));
  });
});

test("add stores the resume type that went with an application", () => {
  const tmp = makeRepo("seekter-resumetype-");
  try {
    const r = runIn(tmp, "seekter.mjs", ["add", "--company", "Acme", "--role", "Designer", "--url", "https://acme.com/careers/1234567", "--resume", "design-system-designer"]);
    assert.equal(r.rc, 0, r.err);
    assert.match(fs.readFileSync(path.join(tmp, r.out.trim().split("\n")[0]), "utf8"), /^resume: design-system-designer$/m);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
