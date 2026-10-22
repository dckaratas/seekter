#!/usr/bin/env node
// Step 1 of a run: sweep the freehire.me API with the queries in profile/settings.json,
// drop closed / sensitive / wrong-language / stale / off-title / already-tracked postings,
// and print the candidates. Node 20+, no packages.
//
//   node scripts/freehire_sweep.mjs              # sweep, write runs/<today>/freehire.json
//   node scripts/freehire_sweep.mjs --detail N   # grep eligibility lines for candidate N (or all)
import fs from "node:fs";
import path from "node:path";
import { ROOT, TODAY, settings, SettingsError, allApps, jobKey, die, runMain, parseArgs } from "./seekter.mjs";
import { getJson, pool, pyRegex, pyDumps, pyStr, htmlUnescape } from "./_shared.mjs";

const OUT = path.join(ROOT, "runs", TODAY);
const ELIG = /[^.\n]*(based in|authori[sz]ed to work|eligible to work|residen|time ?zone|GMT|CET|UTC|countr|relocat|sponsor|visa|hybrid|office|remote|years)[^.\n]*/gi;
let CFG, FH;

const curl = (url) => getJson(url, 40, {});
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

async function search(kw) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(kw)) params.append(k, String(v));
  // default ordering = relevance. Never sort by date (floods off-topic titles).
  if (!("limit" in kw)) params.append("limit", "100");
  const d = await curl("https://freehire.me/api/v1/jobs/search?" + params.toString());
  return (isObj(d) && d.data) || [];
}

// Every search term is the candidate's, so an unfilled config stops the run instead of
// sweeping with a default that belongs to someone else's field.
function require(...keys) {
  const missing = keys.filter((k) => !truthy(k in FH ? FH[k] : CFG[k]));
  if (missing.length) {
    die("No freehire " + missing.join(", ") + " in profile/settings.json" +
      " yet. Run /seekter-init, or fill them in by hand (see templates/settings.json).");
  }
}

// Python's truthiness, which the settings checks were written against: [] and {} are false.
const truthy = (v) => !(v === undefined || v === null || v === false || v === 0 || v === "" ||
  (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length));

// Whole days between `iso` and now, or 99 when the date is missing, unparseable or has no
// time zone (Python refused to subtract a naive date from an aware one, and so do we).
function ageDays(iso, now) {
  if (typeof iso !== "string" || !/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(iso) || !/T|\s\d/.test(iso)) return 99;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 99 : Math.floor((now - t) / 86400000);
}

async function sweep() {
  require("queries", "categories", "title_keep");
  // A home-country-only candidate sweeps by `countries` alone; one of the two must be set.
  if (!(truthy(FH.regions) || truthy(FH.home_country))) require("regions");
  const jobs = [];
  for (const q of FH.queries) for (const c of FH.categories) for (const r of FH.regions || []) {
    jobs.push({ q, category: c, work_mode: "remote", regions: r });
  }
  if (FH.home_country) for (const q of FH.queries) jobs.push({ q, countries: FH.home_country });
  const rows = new Map();
  for (const res of await pool(jobs, 8, search)) {
    for (const j of res) rows.set(j.public_slug || j.slug, j);
  }
  const keep = pyRegex(CFG.title_keep, "title_keep");
  const drop = pyRegex(CFG.title_drop || "(?!)", "title_drop");
  const blocked = new Set(CFG.blocked_domains ?? ["gambling"]);
  const langs = new Set(CFG.languages ?? ["en"]);
  const window = parseInt(FH.window_days ?? 3, 10);
  const tracked = new Set(allApps().map((r) => r.job_key));
  const now = Date.now();
  const out = [];
  const stats = { raw: rows.size, closed: 0, sector: 0, language: 0, title: 0, stale: 0, tracked: 0 };
  for (const [s, j] of rows) {
    const e = j.enrichment || {};
    if (j.closed_at) { stats.closed++; continue; }
    if ((e.domains || []).some((d) => blocked.has(d))) { stats.sector++; continue; }
    if (e.posting_language && !langs.has(e.posting_language)) { stats.language++; continue; }
    const t = j.title ?? "";
    if (!keep.test(t) || drop.test(t)) { stats.title++; continue; }
    const age = ageDays(j.posted_at || j.created_at, now);
    if (age > window) { stats.stale++; continue; }
    let url = (j.url || "").replace(/[?&]utm_[^&]*/g, "");
    if (!url.includes("?")) url = url.replace("&", "?");
    if (tracked.has(jobKey(url))) { stats.tracked++; continue; }
    const co = j.company;
    out.push({ slug: s ?? null, title: t, company: (isObj(co) ? co.name : co) ?? null, location: j.location ?? null,
      countries: j.countries ?? null, regions: j.regions ?? null, work_mode: j.work_mode ?? null, age, url,
      domains: e.domains ?? null, reality: (j.reality || {}).class ?? null });
  }
  out.sort((a, b) => a.age - b.age);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "freehire.json"), JSON.stringify(out, null, 1), "utf8");
  console.log(pyDumps(stats), `→ ${out.length} candidates  (runs/${TODAY}/freehire.json)`);
  out.forEach((o, i) => console.log(`${String(i).padStart(2)} | ${o.age}d | ${pyStr(o.company)} | ${o.title} | ${pyStr(o.location)} | ${[...o.url].slice(0, 80).join("")}`));
}

async function detail(which) {
  const cand = JSON.parse(fs.readFileSync(path.join(OUT, "freehire.json"), "utf8"));
  const idx = which === "all" ? cand.map((_, i) => i) : which.split(",").map((x) => parseInt(x, 10));
  for (const i of idx) {
    const o = cand[i];
    let j = await curl("https://freehire.me/api/v1/jobs/" + o.slug);
    j = isObj(j) && "data" in j ? j.data : j;
    const d = htmlUnescape((j.description || "").replace(/<[^>]+>/g, " "));
    console.log(`===== ${i} | ${pyStr(o.company)} | ${o.title} | ${pyStr(j.countries)} ${pyStr(j.regions)}\n${o.url}`);
    const seen = [];
    for (const m of d.matchAll(ELIG)) {
      const s = [...m[0].replace(/\s+/g, " ").trim()].slice(0, 220).join("");
      if (!seen.includes(s)) { seen.push(s); console.log("  -", s); }
      if (seen.length >= 12) break;
    }
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2), { usage: "node scripts/freehire_sweep.mjs [--detail N]",
    options: { detail: { default: null } } });
  try { CFG = settings(); } catch (e) {
    if (e instanceof SettingsError) die(`problem: profile/settings.json is not valid: ${e.message}`);
    throw e;
  }
  FH = CFG.freehire || {};
  return a.detail ? detail(a.detail) : sweep();
}

await runMain(main);
