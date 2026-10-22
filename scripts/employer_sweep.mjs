#!/usr/bin/env node
// Step 3 of a run, the cheap part: read the job boards of the employers on the candidate's
// watchlist straight from their public ATS APIs, and the latest Hacker News "Who is hiring?"
// thread. No browser, no login, no aggregator in between.
//
//   node scripts/employer_sweep.mjs          # watchlist from `employers` in profile/settings.json
//                                            # (one reader per system in scripts/providers/)
//   node scripts/employer_sweep.mjs --hn     # this month's HN "Who is hiring?" thread
//
// Postings are filtered with the profile's title_keep / title_drop and deduped against the
// tracker. What is left still needs its location line read before anything is filled.
import fs from "node:fs";
import path from "node:path";
import { ROOT, TODAY, settings, SettingsError, allApps, jobKey, die, runMain, parseArgs } from "./seekter.mjs";
import { getJson, getText, sleep, pyRegex, htmlUnescape } from "./_shared.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT = path.join(ROOT, "runs", TODAY);
const GAP = 1000; // public APIs, but still one request after another (reference/sources/_core.md)
let CFG;

const curl = (url) => getJson(url, 30, null);

// One file per application system in scripts/providers/, named after the `ats` value of a
// watchlist row (see scripts/providers/README.md). Loaded on demand, so a row naming a system
// with no file is reported rather than guessed.
const PROVIDERS = path.join(path.dirname(fileURLToPath(import.meta.url)), "providers");
const loaded = new Map();
async function provider(ats) {
  if (!/^[a-z0-9-]+$/.test(ats || "")) return null;
  if (!loaded.has(ats)) {
    const file = path.join(PROVIDERS, `${ats}.mjs`);
    loaded.set(ats, fs.existsSync(file) ? (await import(pathToFileURL(file).href)).default : null);
  }
  return loaded.get(ats);
}
const net = () => ({ json: (url, post = null) => getJson(url, 30, null, post), text: (url) => getText(url, 30),
  queries: (CFG.freehire || {}).queries || [] });

function titleFilters() {
  const keep = CFG.title_keep || "";
  if (!keep) die("No title_keep in profile/settings.json yet. Run /seekter-init, or fill it in by hand.");
  return [pyRegex(keep, "title_keep"), pyRegex(CFG.title_drop || "(?!)", "title_drop")];
}

const writeOut = (name, data) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 1), "utf8");
};

async function employers() {
  const [keep, drop] = titleFilters();
  const tracked = new Set(allApps().map((r) => r.job_key));
  const watch = CFG.employers || [];
  if (!watch.length) {
    die("No employers in profile/settings.json yet. Add {name, ats, slug} rows " +
      "(see templates/settings.json and reference/sources/direct-employer.md).");
  }
  const out = [], problems = [];
  let seen = 0;
  for (const [i, e] of watch.entries()) {
    const fetchBoard = await provider(e.ats ?? "");
    const jobs = fetchBoard ? await fetchBoard(e.slug ?? "", net()) : null;
    if (jobs === null) problems.push(`${e.name}: no board at ${e.ats}:${e.slug}`);
    else {
      seen += jobs.length;
      for (const j of jobs) {
        if (!keep.test(j.title) || drop.test(j.title)) continue;
        if (tracked.has(jobKey(j.url))) continue;
        out.push({ company: e.name ?? null, ...j });
      }
    }
    if (i < watch.length - 1) await sleep(GAP);
  }
  writeOut("employers.json", out);
  console.log(`${watch.length} boards, ${seen} postings → ${out.length} candidates  (runs/${TODAY}/employers.json)`);
  out.forEach((o, i) => console.log(`${String(i).padStart(2)} | ${o.company} | ${o.title} | ${[...o.location].slice(0, 60).join("")} | ${o.url}`));
  for (const p of problems) console.log("problem:", p);
}

const clean = (text) => htmlUnescape((text || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function hn() {
  const [keep, drop] = titleFilters();
  const hits = ((await curl("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5")) || {}).hits || [];
  const story = hits.find((h) => (h.title || "").startsWith("Ask HN: Who is hiring?"));
  if (!story) die("problem: could not find this month's 'Who is hiring?' thread");
  const thread = (await curl(`https://hn.algolia.com/api/v1/items/${story.objectID}`)) || {};
  const posts = (thread.children || []).filter((c) => c.text);
  const out = [];
  for (const c of posts) {
    const raw = htmlUnescape(c.text);
    const text = clean(raw);
    const head = [...text].slice(0, 200).join("");
    // The first line of an HN job post is its header: company | role | location | type.
    if (!keep.test(text) || (drop.test(head) && !keep.test(head))) continue;
    const links = [...raw.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    out.push({ id: c.id, header: head, remote: /\bremote\b/i.test(text), links: links.slice(0, 3),
      url: `https://news.ycombinator.com/item?id=${c.id}` });
  }
  writeOut("hn.json", out);
  console.log(`${story.title}: ${posts.length} posts → ${out.length} mention the candidate's titles  (runs/${TODAY}/hn.json)`);
  out.forEach((o, i) => console.log(`${String(i).padStart(2)} | ${o.remote ? "R" : "-"} | ${[...o.header].slice(0, 150).join("")} | ${o.url}`));
}

async function main() {
  const a = parseArgs(process.argv.slice(2), { usage: "node scripts/employer_sweep.mjs [--hn]", options: { hn: { flag: true } } });
  try { CFG = settings(); } catch (e) {
    if (e instanceof SettingsError) die(`problem: profile/settings.json is not valid: ${e.message}`);
    throw e;
  }
  return a.hn ? hn() : employers();
}

await runMain(main);
