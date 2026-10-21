#!/usr/bin/env node
// CV engine: a resume as JSON in, an ATS-readable A4 PDF out. Node 20+, no packages; the
// PDF is printed by the Chrome (or Chromium, or Edge) already on the machine.
//
//   node scripts/cv.mjs pdf  profile/resumes/<name>.json [--out file.pdf] [--html file.html]
//   node scripts/cv.mjs html profile/resumes/<name>.json [--out file.html]
//   node scripts/cv.mjs check profile/resumes/<name>.json     # print what was read, render nothing
//
// The JSON is the resume format of seekter.dev's editor (`ResumeData`), so a resume
// exported from the site renders here unchanged, and the look is the same file:
// templates/cv/cv.css is seekter-web/src/styles/cv.css. templates/cv/example.json is a
// complete, fictional example. SEEKTER_CHROME names the browser binary when it is not in
// a standard place.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { ROOT, die, runMain, parseArgs } from "./seekter.mjs";

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
export function loadResume(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { die(`problem: ${file} is not valid JSON: ${e.message}`); }
  if (isObj(raw?.resume?.data)) raw = raw.resume.data;
  else if (isObj(raw?.data) && isObj(raw.data.header)) raw = raw.data;
  return mergeResume(raw);
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

function experience(e) {
  const dates = formatDateRange(e.start, e.end);
  const company = [e.company, e.location, e.remote ? "Remote" : null].filter(Boolean).join(" · ");
  const bullets = e.bullets.filter((b) => b.text.trim());
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
    case "experience": return d.experience.length ? section("Experience", d.experience.map(experience).join("")) : "";
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
  return `<div class="cv-root">${header(d.header)}${d.sectionOrder.filter((k) => !hidden.has(k)).map((k) => sectionByKey(k, d)).join("")}</div>`;
}

export function renderHtml(d) {
  const css = fs.readFileSync(CSS, "utf8");
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

// ---------- commands ----------
function summary(d) {
  const h = d.header;
  const lines = [`name: ${h.full_name}`, `role: ${h.role}`, `contact: ${[h.location, h.phone, h.email].filter(Boolean).join(" · ")}`,
    `links: ${h.links.map((l) => l.url).join(" · ")}`, `sections: ${d.sectionOrder.filter((k) => !d.hiddenSections.includes(k)).join(", ")}` +
    (d.hiddenSections.length ? ` (hidden: ${d.hiddenSections.join(", ")})` : "")];
  for (const e of d.experience) lines.push(`  ${formatDateRange(e.start, e.end) || "-"} | ${e.role} | ${e.company} | ${e.bullets.length} bullets`);
  return lines.join("\n");
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const usage = "node scripts/cv.mjs {pdf,html,check} <resume.json> [--out FILE] [--html FILE]";
  if (!["pdf", "html", "check"].includes(cmd)) die(`usage: ${usage}`, 2);
  const a = parseArgs(rest, { usage, positional: ["resume"], options: { out: { default: null }, html: { default: null } } });
  const d = loadResume(a.resume);
  if (cmd === "check") { console.log(summary(d)); return 0; }
  const base = a.resume.replace(/\.json$/i, "");
  if (cmd === "html") {
    const out = a.out || `${base}.html`;
    fs.writeFileSync(out, renderHtml(d), "utf8");
    console.log(out);
    return 0;
  }
  const out = path.resolve(a.out || `${base}.pdf`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const htmlFile = a.html ? path.resolve(a.html) : path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seekter-cv-html-")), "cv.html");
  fs.writeFileSync(htmlFile, renderHtml(d), "utf8");
  try { printPdf(htmlFile, out); } finally { if (!a.html) fs.rmSync(path.dirname(htmlFile), { recursive: true, force: true }); }
  console.log(path.relative(process.cwd(), out) || out);
  return 0;
}

// Imported by the tests, run as a script by everyone else.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  await runMain(main);
}
