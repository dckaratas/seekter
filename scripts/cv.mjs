#!/usr/bin/env node
// CV engine. One master CV holds every fact and a pool of bullets; each CV type ("variant")
// picks from it: its own headline and summary, which bullets of each job and in what order,
// which projects and skill groups. Printed as an ATS-readable A4 PDF by the Chrome (or
// Chromium, or Edge) already on the machine. Node 20+, no packages.
//
//   node scripts/cv.mjs list     profile/resumes/cv.json                   # the CV types and their PDFs
//   node scripts/cv.mjs validate profile/resumes/cv.json [--pages]         # facts, numbers, dates, voice, first page; --pages prints to count pages
//   node scripts/cv.mjs pdf      profile/resumes/cv.json --all             # print every CV type to its PDF
//   node scripts/cv.mjs pdf      profile/resumes/cv.json --variant <name> [--out file.pdf]
//   node scripts/cv.mjs build    profile/resumes/cv.json --variant <name>  # the seekter.dev resume JSON for one type
//   node scripts/cv.mjs check    <file.json> [--variant <name>]            # print what was read, render nothing
//
// A single resume in seekter.dev's format (`ResumeData`, no "variants") also renders, so a
// resume exported from the site works unchanged. The look is templates/cv/cv.css, the site's
// own stylesheet; templates/cv/example.json is a complete, fictional master CV. SEEKTER_CHROME
// names the browser binary when it is not in a standard place.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { ROOT, die, runMain, parseArgs, isMainModule } from "./seekter.mjs";

export const SECTIONS = ["summary", "experience", "projects", "education", "skills", "certifications", "languages"];
const CSS = path.join(ROOT, "templates", "cv", "cv.css");

// ---------- reading: the same leniency as seekter-web's mergeResumeData ----------
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);

function mergeHeader(raw) {
  const s = isObj(raw) ? raw : {};
  const explicit = arr(s.links);
  const legacy = [];
  for (const [key, label] of [["website", "Website"], ["linkedin", "LinkedIn"], ["github", "GitHub"]]) {
    if (typeof s[key] === "string" && s[key].trim()) legacy.push({ id: `link_${key}`, label, url: s[key].trim() });
  }
  return { full_name: s.full_name ?? "", role: s.role ?? "", location: s.location ?? "", email: s.email ?? "",
    phone: s.phone ?? "", links: explicit.length ? explicit : legacy };
}

function toBullets(raw) {
  return arr(raw).map((b) => (typeof b === "string" ? { text: b } : isObj(b) && "text" in b ? { text: String(b.text ?? "") } : null))
    .filter(Boolean);
}

function order(raw) {
  const incoming = arr(raw).filter((k) => SECTIONS.includes(k));
  // Sections missing from an older file are appended, so a new section shows up on its own.
  for (const k of SECTIONS) if (!incoming.includes(k)) incoming.push(k);
  return incoming;
}

export function mergeResume(raw) {
  const s = isObj(raw) ? raw : {};
  return {
    header: mergeHeader(s.header),
    summary: s.summary ?? "",
    experience: arr(s.experience).map((e) => ({ ...e, bullets: toBullets(e?.bullets) })),
    education: arr(s.education),
    skills: arr(s.skills),
    projects: arr(s.projects),
    certifications: arr(s.certifications),
    languages: arr(s.languages),
    sectionOrder: order(s.sectionOrder),
    // A missing value means nothing is hidden, which is what every resume written before
    // the switch existed should get: the feature must never blank out a filled-in section.
    hiddenSections: [...new Set(arr(s.hiddenSections).filter((k) => SECTIONS.includes(k)))],
  };
}

// A file exported from the site's API wraps the data: {"resume": {"title", "data": {...}}}.
export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { die(`problem: ${file} is not valid JSON: ${e.message}`); }
}

export const isMaster = (raw) => isObj(raw) && isObj(raw.variants);

export function loadResume(file, variant = null) {
  let raw = readJson(file);
  if (isMaster(raw)) {
    if (!variant) die(`problem: ${file} is a master CV; name a type with --variant (${Object.keys(raw.variants).join(", ")})`);
    return buildVariant(raw, variant);
  }
  if (isObj(raw?.resume?.data)) raw = raw.resume.data;
  else if (isObj(raw?.data) && isObj(raw.data.header)) raw = raw.data;
  return mergeResume(raw);
}

// ---------- the master CV and its types ----------
// A bullet in the pool is {id, text, tags[], draft?}. A type picks bullets either by id
// (`bullets: {<job id>: [bullet ids]}`, in that order) or by tag: every bullet that shares a
// tag with the type, most relevant first (a tag earlier in the type's list weighs more), up to
// `bullets_per_job`, and fewer for older jobs (`older`: [{before: "YYYY-MM", bullets: n}, ...]).
// `descriptions: {before}` and `education_notes: false` shorten a type further.
const textOf = (b) => (typeof b === "string" ? b : b?.text ?? "");

export function pickBullets(job, v) {
  const pool = arr(job.bullets).map((b, i) => (typeof b === "string" ? { id: `b${i}`, text: b, tags: [] } : { ...b, tags: arr(b.tags) }));
  const explicit = isObj(v.bullets) ? v.bullets[job.id] : undefined;
  if (Array.isArray(explicit)) return explicit.map((id) => pool.find((b) => b.id === id)).filter(Boolean).map((b) => shortened(b, v));
  const tags = arr(v.tags);
  // `older` is one tier ({before, bullets}) or a list of them; the earliest cut-off a job falls under wins.
  const tiers = (Array.isArray(v.older) ? v.older : isObj(v.older) ? [v.older] : []).filter((x) => x.before)
    .sort((x, y) => (x.before < y.before ? -1 : 1));
  const tier = tiers.find((x) => (job.start || "") < x.before);
  const cap = isObj(v.caps) && Number.isInteger(v.caps[job.id]) ? v.caps[job.id] : tier ? (tier.bullets ?? 2) : (v.bullets_per_job ?? 4);
  if (!tags.length) return pool.slice(0, cap).map((b) => shortened(b, v));
  const score = (b) => tags.reduce((s, t, i) => s + (b.tags.includes(t) ? tags.length - i : 0), 0);
  return pool.map((b, i) => ({ b, i, s: score(b) })).filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.i - y.i).slice(0, cap).map((x) => shortened(x.b, v));
}

// A type with `short: true` prints a bullet's `short` text where it has one. A short text is
// new wording, so it is a draft until approved (`short_draft` removed).
function shortened(b, v) {
  if (!v.short || !b.short) return b;
  return { ...b, text: b.short, draft: b.draft || !!b.short_draft };
}

// Jobs that started before `earlier.before` fold into one closing line: title, company and
// dates, no bullets. Older experience stays visible without taking a page.
const ym = (s) => formatDate(s || "") || s || "";
const isEarlier = (e, v) => isObj(v.earlier) && v.earlier.before && (e.start || "") < v.earlier.before;
function earlierLine(jobs, v) {
  const old = jobs.filter((e) => isEarlier(e, v));
  if (!old.length) return null;
  const line = old.map((e) => `${[e.role, e.company && !/^earlier/i.test(e.company) ? e.company : ""].filter(Boolean).join(", ")} (${ym(e.start)} - ${ym(e.end)})`).join(" · ");
  const starts = old.map((e) => e.start).filter(Boolean).sort(), ends = old.map((e) => e.end).filter(Boolean).sort();
  return { id: "earlier", role: v.earlier.title || "Earlier experience", company: "", start: starts[0] || "",
    end: ends[ends.length - 1] || "", description: line, bullets: [] };
}

// `descriptions`: true (default), false, or {before: "YYYY-MM"} to keep them only for later jobs.
const showDescription = (e, v) => v.descriptions === false ? false
  : isObj(v.descriptions) && v.descriptions.before ? (e.start || "") >= v.descriptions.before : true;

export function buildVariant(master, name) {
  const v = master.variants?.[name];
  if (!isObj(v)) die(`problem: no CV type "${name}"; the types are ${Object.keys(master.variants || {}).join(", ")}`);
  const keep = (list, ids) => (Array.isArray(ids) ? ids.map((id) => list.find((x) => x.id === id)).filter(Boolean) : list);
  const drop = new Set(arr(v.drop));
  const kept = arr(master.experience).filter((e) => !drop.has(e.id));
  const experience = kept.filter((e) => !isEarlier(e, v)).map((e) => ({
    ...e, description: !showDescription(e, v) ? "" : v.short && e.short_description ? e.short_description : e.description,
    bullets: pickBullets(e, v).map((b) => ({ text: b.text })) }));
  const earlier = earlierLine(kept, v);
  if (earlier) experience.push(earlier);
  return withLayout(v.layout, {
    header: { ...master.header, role: v.role ?? master.header?.role ?? "" },
    summary: v.summary ?? master.summary ?? "",
    experience,
    projects: keep(arr(master.projects), v.projects).map((p) => (v.short && p.short_description ? { ...p, description: p.short_description } : p)),
    // `skill_items` caps each group's list, keeping the order the master gives.
    skills: keep(arr(master.skills), v.skills).map((s) => (Number.isInteger(v.skill_items) ? { ...s, items: arr(s.items).slice(0, v.skill_items) } : s)),
    education: keep(arr(master.education), v.education).map((e) => (v.education_notes === false ? (({ note, ...rest }) => rest)(e) : e)),
    certifications: keep(arr(master.certifications), v.certifications),
    languages: arr(master.languages),
    sectionOrder: v.sectionOrder ?? master.sectionOrder,
    hiddenSections: v.hiddenSections ?? master.hiddenSections,
  });
}

// `layout: "compact"` keeps the look but puts each job on one line and tightens the spacing.
function withLayout(layout, raw) {
  const d = mergeResume(raw);
  if (layout === "compact") d.layout = "compact";
  return d;
}

// The draft bullets a type would print. A draft is text the candidate has not approved yet.
export function draftsIn(master, name) {
  const v = master.variants[name];
  return arr(master.experience).filter((e) => !arr(v.drop).includes(e.id) && !isEarlier(e, v))
    .flatMap((e) => pickBullets(e, v).filter((b) => b.draft).map((b) => `${e.company}: ${b.id}`)
      .concat(v.short && e.short_description && e.short_description_draft && showDescription(e, v) ? [`${e.company}: short description`] : []))
    .concat(v.draft ? [`the type itself (headline or summary)`] : []);
}

// ---------- validation ----------
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const norm = (s) => String(s ?? "").toLowerCase().replace(/[–—]/g, "-").replace(/×/g, "x").replace(/\s+/g, " ");

// Every number a reader could check: 870, 50+, 15-20, 1,500, 2-3x, 5-10.
const NUMBER = /\d[\d,.]*(?:\s?[-–]\s?\d[\d,.]*)?\s?(?:%|\+|x|×)?/g;

function numbersIn(text) {
  return [...new Set((text.match(NUMBER) || []).map((n) => n.trim().replace(/[.,]$/, "")).filter((n) => /\d/.test(n)))];
}

function ymFromWords(s) {
  const out = [];
  for (const m of s.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b|\bpresent\b/gi)) {
    out.push(m[0].toLowerCase() === "present" ? "present" : `${m[2]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}`);
  }
  return out;
}

// The profile's work history table: | Company | Title | Dates |.
function workHistory(profile) {
  const rows = [];
  let inTable = false;
  for (const line of profile.split("\n")) {
    if (/^\|\s*Company\s*\|\s*Title\s*\|\s*Dates\s*\|/i.test(line)) { inTable = true; continue; }
    if (!inTable) continue;
    if (!line.startsWith("|")) { inTable = false; continue; }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3 || /^-+$/.test(cells[0])) continue;
    const [start, end] = ymFromWords(cells[2]);
    rows.push({ company: cells[0].replace(/\*/g, ""), title: cells[1], start, end });
  }
  return rows;
}

// The literal phrases of the profile's "Banned phrases" line; descriptions of patterns
// ("a colon followed by...", "not just X but Y") are for a reader, not a search.
function bannedPhrases(profile) {
  const m = profile.match(/Banned phrases:?\**:?\s*(.+)/i);
  if (!m) return [];
  return m[1].replace(/\.$/, "").split("·").flatMap((p) => {
    const quoted = p.match(/"([^"]+)"/);
    if (quoted) return [quoted[1]];
    if (/\b(X|Y)\b|followed by|as filler|\{\{/.test(p)) return [];
    return p.split("/").map((x) => x.trim()).filter((x) => x && x.split(" ").length <= 4);
  });
}

const sameCompany = (a, b) => {
  const k = (s) => norm(s).replace(/\.(com|digital|io|app)\b/g, "").replace(/[^a-z0-9ğüşıöç]+/g, "");
  return k(a) === k(b) || k(a).startsWith(k(b)) || k(b).startsWith(k(a));
};

export function validate(master, profile) {
  const problems = [], checks = [];
  const exp = arr(master.experience);
  const ids = new Set();
  for (const e of exp) {
    if (!e.id) problems.push(`a job has no id: ${e.role} at ${e.company}`);
    for (const b of arr(e.bullets)) {
      if (typeof b === "string" || !b.id) problems.push(`${e.company}: a bullet has no id ("${textOf(b).slice(0, 50)}...")`);
      else if (ids.has(`${e.id}/${b.id}`)) problems.push(`${e.company}: bullet id ${b.id} is used twice`);
      else ids.add(`${e.id}/${b.id}`);
    }
    for (const f of ["start", "end"]) {
      if (e[f] && !/^\d{4}(-\d{2})?$/.test(e[f]) && !/^present$/i.test(e[f])) problems.push(`${e.company}: ${f} "${e[f]}" is not YYYY-MM, YYYY or present`);
    }
  }
  // Each type's picks must exist, and it must print something.
  for (const [name, v] of Object.entries(master.variants || {})) {
    if (isObj(v.bullets)) {
      for (const [job, list] of Object.entries(v.bullets)) {
        const e = exp.find((x) => x.id === job);
        if (!e) { problems.push(`${name}: picks bullets of an unknown job "${job}"`); continue; }
        for (const id of arr(list)) if (!arr(e.bullets).some((b) => b.id === id)) problems.push(`${name}: ${e.company} has no bullet "${id}"`);
      }
    }
    for (const [key, list] of [["projects", master.projects], ["skills", master.skills], ["certifications", master.certifications], ["education", master.education]]) {
      for (const id of arr(v[key])) if (!arr(list).some((x) => x.id === id)) problems.push(`${name}: unknown ${key} id "${id}"`);
    }
    for (const id of arr(v.drop)) if (!exp.some((e) => e.id === id)) problems.push(`${name}: drops an unknown job "${id}"`);
    const d = buildVariant(master, name);
    const words = renderBody(d).replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    if (words > 1000) checks.push(`${name}: about ${words} words, likely more than two pages`);
    // The first screen decides: a headline for the role, where the candidate is, a portfolio
    // link a reviewer can open, and a summary short enough to be read.
    if (!d.header.role?.trim()) checks.push(`${name}: no headline`);
    if (!d.header.location?.trim()) checks.push(`${name}: no location in the header`);
    if (!d.header.links.some((l) => /portfolio|website|site/i.test(l.label || "") || /portfolio/i.test(l.url || ""))) checks.push(`${name}: no link labelled Portfolio in the header`);
    const sw = (d.summary || "").split(/\s+/).filter(Boolean).length;
    if (sw > 70) checks.push(`${name}: the summary is ${sw} words; two or three lines read better`);
    for (const e of d.experience) for (const b of e.bullets) {
      if (b.text.length > 200) checks.push(`${name}: ${e.company}: a ${b.text.length}-character bullet ("${b.text.slice(0, 40)}...")`);
    }
    const drafts = draftsIn(master, name);
    if (drafts.length) checks.push(`${name}: prints ${drafts.length} draft(s) not yet approved: ${drafts.join("; ")}`);
  }
  if (!profile) return { problems, checks: [...checks, "no profile to check facts against"] };
  // Dates and titles against the profile's work history.
  const history = workHistory(profile);
  for (const e of exp) {
    const h = history.filter((r) => sameCompany(r.company, e.company));
    if (!history.length) break;
    if (!h.length) { checks.push(`${e.company} (${e.start}..${e.end || "open"}): not in the profile's work history`); continue; }
    const r = h.find((x) => x.start === e.start) || h[0];
    const end = /^present$/i.test(e.end || "") ? "present" : e.end || "";
    if (r.start && e.start && r.start !== e.start) checks.push(`${e.company}: starts ${e.start} here, ${r.start} in the profile`);
    if (r.end && r.end !== (end || "present")) checks.push(`${e.company}: ends ${end || "open"} here, ${r.end} in the profile`);
    if (r.title && norm(r.title) !== norm(e.role) && !norm(r.title).includes(norm(e.role))) checks.push(`${e.company}: "${e.role}" here, "${r.title}" in the profile`);
  }
  // Numbers a reader could check must be in the profile's facts.
  const prof = norm(profile).replace(/,(?=\d{3})/g, "");
  const texts = [];
  for (const e of exp) { texts.push([e.company, e.description || ""]); for (const b of arr(e.bullets)) texts.push([`${e.company} ${b.id ?? ""}`, textOf(b)]); }
  for (const p of arr(master.projects)) texts.push([p.name, p.description || ""]);
  for (const [name, v] of Object.entries(master.variants || {})) texts.push([`${name} summary`, v.summary || ""], [`${name} headline`, v.role || ""]);
  if (master.summary) texts.push(["summary", master.summary]);
  const seen = new Set();
  for (const [where, text] of texts) {
    for (const n of numbersIn(text)) {
      const key = norm(n).replace(/,(?=\d{3})/g, "").replace(/\s/g, "");
      if (/^(19|20)\d{2}$/.test(key) || /^\d$/.test(key) || seen.has(`${where}|${key}`)) continue;
      seen.add(`${where}|${key}`);
      const bare = key.replace(/[+%x]$/, "");
      if (!prof.includes(key) && !prof.includes(bare) && !prof.includes(bare.replace("-", "–"))) checks.push(`${where}: "${n}" is not in the profile's facts`);
    }
  }
  // Voice: the profile's banned phrases, and long dashes.
  const banned = bannedPhrases(profile);
  for (const [where, text] of texts) {
    const low = norm(text);
    for (const b of banned) if (new RegExp(`\\b${b.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(low)) checks.push(`${where}: uses "${b}" (banned in the profile's voice)`);
    if (/—/.test(text)) checks.push(`${where}: a long dash`);
  }
  // Overlapping jobs are worth a look (a side project inside a job is fine, two full-time jobs less so).
  const span = exp.filter((e) => e.start).map((e) => ({ e, s: e.start, f: /^present$/i.test(e.end || "") || !e.end ? "9999" : e.end }));
  for (let i = 0; i < span.length; i++) for (let j = i + 1; j < span.length; j++) {
    const a = span[i], b = span[j];
    if (a.s < b.f && b.s < a.f && a.f !== b.s && b.f !== a.s) checks.push(`${a.e.company} and ${b.e.company} overlap (${a.s}..${a.e.end || "open"} / ${b.s}..${b.e.end || "open"})`);
  }
  return { problems, checks };
}

// ---------- rendering: the markup of seekter-web's ResumeRender, as a string ----------
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function toHref(raw) {
  const t = (raw || "").trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

const displayUrl = (raw) => raw.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
const a = (href, text, cls = "") => `<a${cls ? ` class="${cls}"` : ""} href="${esc(toHref(href))}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;

export function formatDate(raw) {
  if (!raw) return "";
  const m = raw.match(/^(\d{4})-(\d{2})$/);
  if (!m) return raw;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatDateRange(start, end) {
  const s = formatDate(start), e = end === "present" ? "Present" : formatDate(end);
  if (!s && !e) return "";
  if (!s) return e;
  if (!e) return s;
  return `${s} - ${e}`;
}

const URL_REGEX = /\b(?:https?:\/\/\S+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/\S*)?)/g;

// Bare URLs and domains in running text become links; trailing punctuation stays text.
function withLinks(text) {
  let out = "", last = 0;
  for (const m of text.matchAll(URL_REGEX)) {
    const raw = m[0];
    // "Next.js" and "Vue.js" are names, not addresses.
    if (!/^https?:|\//i.test(raw) && /\.(js|ts|jsx|tsx|css|scss|md|json|py|rb|go)$/i.test(raw.replace(/[.,;:!?)]+$/, ""))) continue;
    const trailing = raw.match(/[.,;:!?)]+$/);
    const clean = raw.slice(0, raw.length - (trailing ? trailing[0].length : 0));
    out += esc(text.slice(last, m.index)) + a(clean, clean, "cv-link-inline");
    last = m.index + clean.length;
  }
  return out + esc(text.slice(last));
}

const datesAndUrl = (dates, url) => (dates || url)
  ? `<div class="cv-entry-url">${esc(dates)}${dates && url ? " · " : ""}${url ? a(url, url) : ""}</div>` : "";

function header(h) {
  const contact = [h.location, h.phone, h.email].map((x) => x?.trim()).filter(Boolean);
  const links = h.links.filter((l) => l.url?.trim());
  let out = `<header class="cv-header"><h1 class="cv-name">${esc(h.full_name || "Your Name")}</h1>`;
  if (h.role) out += `<div class="cv-tagline">${esc(h.role)}</div>`;
  if (contact.length) out += `<div class="cv-contact"><span style="font-weight:600">Contact:</span> ${esc(contact.join(" · "))}</div>`;
  if (links.length) {
    out += `<div class="cv-contact"><span style="font-weight:600">Links:</span> ` +
      links.map((l, i) => `<span>${a(l.url, displayUrl(l.url))}${i < links.length - 1 ? " · " : ""}</span>`).join("") + "</div>";
  }
  return out + "</header>";
}

const section = (title, body) => `<section class="cv-section"><h2 class="cv-section-title">${esc(title)}</h2><div class="cv-section-body">${body}</div></section>`;

function experience(e, compact) {
  const dates = formatDateRange(e.start, e.end);
  const company = [e.company, e.location, e.remote ? "Remote" : null].filter(Boolean).join(" · ");
  const bullets = e.bullets.filter((b) => b.text.trim());
  if (compact) {
    // One line per job: title and company on the left, dates on the right; no URL line.
    return `<div class="cv-entry"><div class="cv-entry-head-block"><div class="cv-entry-head"><div class="cv-entry-head-left">` +
      `<span class="cv-entry-title">${esc(e.role || "Role")}</span>${company ? `<span class="cv-entry-company"> · ${esc(company)}</span>` : ""}</div>` +
      (dates ? `<div class="cv-entry-dates">${esc(dates)}</div>` : "") + `</div>` +
      (e.description?.trim() ? `<p class="cv-entry-description">${withLinks(e.description)}</p>` : "") + `</div>` +
      (bullets.length ? `<ul class="cv-entry-bullets">${bullets.map((b) => `<li>${withLinks(b.text)}</li>`).join("")}</ul>` : "") + `</div>`;
  }
  return `<div class="cv-entry"><div class="cv-entry-head-block"><div class="cv-entry-head"><div class="cv-entry-head-left">` +
    `<div class="cv-entry-title">${esc(e.role || "Role")}</div><div class="cv-entry-company">${esc(company)}</div>` +
    datesAndUrl(dates, e.url) + `</div></div>` +
    (e.description?.trim() ? `<p class="cv-entry-description">${withLinks(e.description)}</p>` : "") + `</div>` +
    (bullets.length ? `<ul class="cv-entry-bullets">${bullets.map((b) => `<li>${withLinks(b.text)}</li>`).join("")}</ul>` : "") +
    `</div>`;
}

function education(e) {
  const dates = formatDateRange(e.start, e.end);
  return `<div class="cv-entry cv-education"><div class="cv-entry-head"><div class="cv-entry-head-left">` +
    `<div class="cv-entry-title">${esc(e.school || "School")}</div>` +
    (e.degree ? `<div class="cv-entry-company">${esc(e.degree)}</div>` : "") + `</div>` +
    (dates ? `<div class="cv-entry-dates">${esc(dates)}</div>` : "") + `</div>` +
    (e.note ? `<p class="cv-entry-description">${esc(e.note)}</p>` : "") + `</div>`;
}

function skillRow(g) {
  const items = arr(g.items).map((item, i, all) => `<span class="cv-skill-item">${esc(item)}${i < all.length - 1 ? "," : ""}</span>`).join(" ");
  return `<p class="cv-skill-group"><strong class="cv-skill-label">${esc(g.group || "Skills")}:</strong> <span class="cv-skill-items">${items}</span></p>`;
}

function project(p) {
  const dates = formatDate(p.start ?? "") || (p.start ?? "").trim();
  return `<div class="cv-project"><div class="cv-project-head"><div class="cv-project-head-left">` +
    `<div class="cv-project-name">${esc(p.name || "Project")}</div>${datesAndUrl(dates, p.url)}</div></div>` +
    (p.description ? `<div class="cv-project-body"><p>${withLinks(p.description)}</p></div>` : "") + `</div>`;
}

function certification(c) {
  const meta = [c.issuer?.trim(), c.year?.trim()].filter(Boolean).join(", ");
  return `<li class="cv-cert-item">${esc(c.name)}${meta ? `<span class="cv-cert-meta"> · ${esc(meta)}</span>` : ""}</li>`;
}

function sectionByKey(key, d) {
  switch (key) {
    case "summary": return d.summary?.trim() ? section("Summary", `<p class="cv-summary">${esc(d.summary)}</p>`) : "";
    case "experience": return d.experience.length ? section("Experience", d.experience.map((e) => experience(e, d.layout === "compact")).join("")) : "";
    case "projects": return d.projects.length ? section("Projects", d.projects.map(project).join("")) : "";
    case "education": return d.education.length ? section("Education", d.education.map(education).join("")) : "";
    case "skills": return d.skills.length ? section("Skills", `<div class="cv-skills">${d.skills.map(skillRow).join("")}</div>`) : "";
    case "certifications": return d.certifications.length
      ? section("Certifications", `<ul class="cv-cert-list">${d.certifications.filter((c) => c.name?.trim()).map(certification).join("")}</ul>`) : "";
    case "languages": return d.languages.length
      ? section("Languages", `<p class="cv-summary">${esc(d.languages.filter((l) => l.name?.trim())
        .map((l) => (l.proficiency ? `${l.name} (${l.proficiency})` : l.name)).join(" · "))}</p>`) : "";
    default: return "";
  }
}

export function renderBody(d) {
  const hidden = new Set(d.hiddenSections);
  return `<div class="cv-root${d.layout === "compact" ? " cv-compact" : ""}">${header(d.header)}${d.sectionOrder.filter((k) => !hidden.has(k)).map((k) => sectionByKey(k, d)).join("")}</div>`;
}

export function renderHtml(d, pageSize = "A4") {
  const css = fs.readFileSync(CSS, "utf8").replace(/size:\s*A4;/, `size: ${pageSize};`);
  return `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>${esc(d.header.full_name || "Resume")}</title>\n` +
    `    <style>${css}</style>\n  </head>\n  <body>${renderBody(d)}</body>\n</html>\n`;
}

// ---------- printing ----------
const CHROMES = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium",
    "/usr/bin/microsoft-edge"],
  win32: [
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
  ],
};

export function findChrome() {
  if (process.env.SEEKTER_CHROME) return process.env.SEEKTER_CHROME;
  const hit = (CHROMES[process.platform] || []).find((p) => p && fs.existsSync(p));
  if (!hit) die("problem: no Chrome, Chromium or Edge found to print the PDF. Set SEEKTER_CHROME to the browser's binary.");
  return hit;
}

// Print an HTML file to PDF with a headless browser. A throwaway profile keeps it apart from
// the browser the user is working in, and the time budget lets the web fonts arrive first:
// a PDF printed before them falls back to the system sans and reflows every page.
export function printPdf(htmlFile, outFile) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "seekter-cv-"));
  try {
    const r = spawnSync(findChrome(), ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      `--user-data-dir=${profile}`, "--no-pdf-header-footer", "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=15000", `--print-to-pdf=${outFile}`, pathToFileURL(htmlFile).href], { encoding: "utf8", timeout: 120000 });
    if (r.error || !fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
      die(`problem: the browser did not write ${outFile}${r.error ? ` (${r.error.message})` : ""}\n${(r.stderr || "").trim().split("\n").slice(-3).join("\n")}`);
    }
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

// Pages of a printed PDF: Chrome writes one /Type /Page object per page.
export const pageCount = (file) => (fs.readFileSync(file).toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;

// Print a type on A4 and on US Letter and count the pages: a CV that fits A4 can spill on Letter.
function measure(d) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seekter-cv-pages-"));
  try {
    return Object.fromEntries(["A4", "Letter"].map((size) => {
      const html = path.join(dir, `${size}.html`), pdf = path.join(dir, `${size}.pdf`);
      fs.writeFileSync(html, renderHtml(d, size), "utf8");
      printPdf(html, pdf);
      return [size, pageCount(pdf)];
    }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ---------- commands ----------
function summary(d) {
  const h = d.header;
  const lines = [`name: ${h.full_name}`, `role: ${h.role}`, `contact: ${[h.location, h.phone, h.email].filter(Boolean).join(" · ")}`,
    `links: ${h.links.map((l) => l.url).join(" · ")}`, `sections: ${d.sectionOrder.filter((k) => !d.hiddenSections.includes(k)).join(", ")}` +
    (d.hiddenSections.length ? ` (hidden: ${d.hiddenSections.join(", ")})` : "")];
  for (const e of d.experience) lines.push(`  ${formatDateRange(e.start, e.end) || "-"} | ${e.role} | ${e.company} | ${e.bullets.length} bullets`);
  return lines.join("\n");
}

function printOne(d, out, htmlOut) {
  out = path.resolve(out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const htmlFile = htmlOut ? path.resolve(htmlOut) : path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seekter-cv-html-")), "cv.html");
  fs.writeFileSync(htmlFile, renderHtml(d), "utf8");
  try { printPdf(htmlFile, out); } finally { if (!htmlOut) fs.rmSync(path.dirname(htmlFile), { recursive: true, force: true }); }
  console.log(path.relative(process.cwd(), out) || out);
}

// A type's PDF path is relative to the repository, e.g. profile/documents/<name>.pdf.
const pdfPath = (v, name) => path.resolve(ROOT, v.pdf || path.join("profile", "documents", `${name}.pdf`));

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const usage = "node scripts/cv.mjs {list,validate,pdf,html,build,check} <cv.json> [--variant NAME | --all] [--out FILE] [--html FILE] [--drafts]";
  if (!["list", "validate", "pdf", "html", "build", "check"].includes(cmd)) die(`usage: ${usage}`, 2);
  const a = parseArgs(rest, { usage, positional: ["resume"], options: { out: { default: null }, html: { default: null },
    variant: { default: null }, all: { flag: true }, drafts: { flag: true }, profile: { default: null }, pages: { flag: true } } });
  const raw = readJson(a.resume);
  const master = isMaster(raw) ? raw : null;
  if (cmd === "list" || cmd === "validate") {
    if (!master) die(`problem: ${a.resume} is a single resume, not a master CV with "variants"`);
  }
  if (cmd === "list") {
    for (const [name, v] of Object.entries(master.variants)) {
      const drafts = draftsIn(master, name).length;
      console.log(`${name} | ${v.role || ""} | ${path.relative(ROOT, pdfPath(v, name))}${drafts ? ` | ${drafts} draft(s)` : ""}`);
    }
    return 0;
  }
  if (cmd === "validate") {
    const prof = path.resolve(a.profile || path.join(ROOT, "profile", "profile.md"));
    const { problems, checks } = validate(master, fs.existsSync(prof) ? fs.readFileSync(prof, "utf8") : "");
    if (a.pages) {
      // Two pages is a ceiling, not a target: past it most screeners call a CV too long.
      for (const [name, v] of Object.entries(master.variants)) {
        const pages = measure(buildVariant(master, name));
        const max = v.max_pages ?? 2;
        const line = `${name}: ${pages.A4} pages on A4, ${pages.Letter} on Letter`;
        if (pages.A4 > max || pages.Letter > max) problems.push(`${line} (the limit is ${max})`);
        else console.log("pages: " + line);
      }
    }
    for (const c of checks) console.log("check: " + c);
    for (const p of problems) console.log("problem: " + p);
    console.log(`${problems.length} problems, ${checks.length} things to check`);
    return problems.length ? 1 : 0;
  }
  if (cmd === "pdf" && a.all) {
    if (!master) die("problem: --all needs a master CV");
    for (const [name, v] of Object.entries(master.variants)) {
      const drafts = draftsIn(master, name);
      if (drafts.length && !a.drafts) { console.log(`skipped ${name}: ${drafts.length} draft(s) not yet approved (--drafts prints them anyway)`); continue; }
      printOne(buildVariant(master, name), pdfPath(v, name), null);
    }
    return 0;
  }
  const d = loadResume(a.resume, a.variant);
  if (cmd === "check") { console.log(summary(d)); return 0; }
  if (cmd === "build") {
    const json = JSON.stringify(d, null, 2) + "\n";
    if (a.out) { fs.writeFileSync(a.out, json, "utf8"); console.log(a.out); } else process.stdout.write(json);
    return 0;
  }
  if (master && !a.drafts) {
    const drafts = draftsIn(master, a.variant);
    if (drafts.length) die(`problem: ${a.variant} prints ${drafts.length} draft(s) not yet approved: ${drafts.join("; ")}. Approve them, or pass --drafts for a review copy.`);
  }
  const base = master ? pdfPath(master.variants[a.variant], a.variant).replace(/\.pdf$/i, "") : a.resume.replace(/\.json$/i, "");
  if (cmd === "html") {
    const out = a.out || `${base}.html`;
    fs.writeFileSync(out, renderHtml(d), "utf8");
    console.log(out);
    return 0;
  }
  printOne(d, a.out || `${base}.pdf`, a.html);
  return 0;
}

// Imported by the tests, run as a script by everyone else.
if (isMainModule(import.meta.url)) {
  await runMain(main);
}
