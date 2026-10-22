#!/usr/bin/env node
// Holds a text a form is about to receive (a cover letter, a free-text answer) to the profile,
// the way `resume.mjs validate` holds the resume to it. Node 20+, no packages.
//
//   node scripts/claims.mjs <file> [<file> ...] [--posting <file>] [--url <apply url>]
//   node scripts/claims.mjs - < answer.txt
//
// Three checks, one line each:
//   number  a number a reader could check that is not in the profile's facts: the fact sections of
//           profile/profile.md (identity, standard answers, salary bands, fact bank), the files
//           those sections point to by path (`profile/...`), and profile/resume/json/resume.json.
//           Dates, times, years, single digits and URLs are not claims, and neither is a salary
//           answer: it is worked out from the band table, which has its own rule. A number the
//           posting itself gives (its "5-minute video") passes when the posting is passed as --posting.
//   voice   a banned phrase from the profile's voice section, or a long dash.
//   repeat  a sentence of eight words or more already sent to another company, from the
//           records' "Answers submitted" sections. Sentences that are in the profile (its standard
//           answers) are meant to repeat and pass. --url leaves out the record of this posting.
//
// Exit code 1 when anything is found, 0 when the text is clean, 2 on a usage error.
import fs from "node:fs";
import path from "node:path";
import { ROOT, die, runMain, parseArgs, isMainModule, allApps, section, jobKey } from "./seekter.mjs";
import { numbersIn, factsOf, knownNumber, bannedPhrases, norm } from "./resume.mjs";

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";

// What is not a claim: links, dates in any common spelling, clock times.
export function withoutDates(text) {
  return String(text ?? "")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, " ")
    .replace(/\b\d{4}-\d{2}(?:-\d{2})?\b/g, " ")
    .replace(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g, " ")
    .replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:\\s+\\d{4})?`, "gi"), " ")
    .replace(new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi"), " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ");
}

// A salary answer is worked out from the band table (a year from a month, one currency from
// another), so its numbers are not in the facts and are not claims either: an amount with a
// currency, and any number in the sentence or form field that names a salary or a rate. Codes
// are matched in capitals only, so "try 30 variants" stays a claim.
const CURRENCY = "(?:EUR|USD|GBP|CAD|CHF|DKK|SEK|NOK|PLN|CZK|TRY|AUD|NZD|CA\\$|US\\$|[€$£₺])";
const AMOUNT = "\\d[\\d,.]*\\s?[km]?";
export function withoutSalary(text) {
  return String(text ?? "")
    .replace(new RegExp(`${CURRENCY}\\s?${AMOUNT}(?:\\s?(?:-|–|to)\\s?${CURRENCY}?\\s?${AMOUNT})?`, "g"), " ")
    .replace(new RegExp(`${AMOUNT}(?:\\s?(?:-|–|to)\\s?${AMOUNT})?\\s?\\(?${CURRENCY}\\b`, "g"), " ")
    .split(/(\n|\||;|(?<=[.!?])\s+)/).map((part) => /salary|compensation|pay expectation|(hourly|daily|day|monthly) rate/i.test(part) ? part.replace(/\d/g, " ") : part).join("");
}

// The facts a text may draw on: the profile, the files its fact sections name, the master resume.
export function factSources(profile, root = ROOT) {
  const texts = [];
  for (const part of String(profile ?? "").split(/^(?=## )/m)) {
    if (!/^##\s*(?:\d+\.\s*)?(identity|standard answers|salary|fact bank)/i.test(part)) continue;
    for (const m of part.matchAll(/`(profile\/[^`\s]+\.(?:md|txt|json))`/g)) {
      const f = path.join(root, m[1]);
      if (fs.existsSync(f)) texts.push(fs.readFileSync(f, "utf8"));
    }
  }
  const resume = path.join(root, "profile", "resume", "json", "resume.json");
  if (fs.existsSync(resume)) texts.push(fs.readFileSync(resume, "utf8"));
  return texts;
}

const sentences = (text) => String(text ?? "").split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const squash = (s) => norm(s).replace(/[^a-z0-9ğüşıöç%+ ]+/g, " ").replace(/\s+/g, " ").trim();

// Sentences already sent, each with the company and date it went to.
function sentBefore(skipKey) {
  const out = new Map();
  for (const r of allApps()) {
    if (r._kind !== "file") continue;
    if (skipKey && r.job_key === skipKey) continue;
    for (const s of sentences(section(r._body || "", "Answers submitted"))) {
      const k = squash(s);
      if (k.split(" ").length >= 8 && !out.has(k)) out.set(k, `${r.company} (${r.applied || r.updated || "no date"})`);
    }
  }
  return out;
}

function around(text, needle) {
  const i = text.indexOf(needle);
  if (i < 0) return "";
  return text.slice(Math.max(0, i - 30), i + needle.length + 30).replace(/\s+/g, " ").trim();
}

export function checkText(text, { profile = "", sources = [], posting = "", sent = new Map() } = {}) {
  const found = [];
  const facts = factsOf(profile);
  for (const t of sources) for (const n of factsOf(withoutDates(t), { sections: false })) facts.add(n);
  const fromPosting = factsOf(withoutDates(posting), { sections: false });
  for (const n of numbersIn(withoutSalary(withoutDates(text)))) {
    if (knownNumber(n, facts)) continue;
    if (posting && knownNumber(n, fromPosting)) continue;
    found.push(["number", `"${n}" is not in the profile's facts: "${around(text, n)}"`]);
  }
  const low = norm(text);
  for (const b of bannedPhrases(profile)) {
    if (new RegExp(`\\b${b.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(low)) found.push(["voice", `uses "${b}" (banned in the profile's voice)`]);
  }
  if (/—/.test(text)) found.push(["voice", `a long dash: "${around(text, "—")}"`]);
  const own = squash(profile);
  for (const s of sentences(text)) {
    const k = squash(s);
    if (k.split(" ").length < 8 || own.includes(k)) continue;
    if (sent.has(k)) found.push(["repeat", `sent before to ${sent.get(k)}: "${s.slice(0, 80)}${s.length > 80 ? "..." : ""}"`]);
  }
  return found;
}

function readInput(f) {
  if (f === "-") { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }
  if (!fs.existsSync(f)) die(`no such file: ${f}`, 2);
  return fs.readFileSync(f, "utf8");
}

async function main() {
  const argv = process.argv.slice(2);
  const files = [], rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--posting" || argv[i] === "--url") rest.push(argv[i], argv[++i]);
    else if (argv[i].startsWith("--")) rest.push(argv[i]);
    else files.push(argv[i]);
  }
  const a = parseArgs(rest, { usage: "node scripts/claims.mjs <file|-> [...] [--posting <file>] [--url <apply url>]",
    options: { posting: { default: null }, url: { default: null } } });
  if (!files.length) files.push("-");
  const profileFile = path.join(ROOT, "profile", "profile.md");
  if (!fs.existsSync(profileFile)) die("profile/profile.md is missing (run /seekter-init)", 2);
  const profile = fs.readFileSync(profileFile, "utf8");
  const sources = factSources(profile);
  const posting = a.posting ? readInput(a.posting) : "";
  const sent = sentBefore(a.url ? jobKey(a.url) : null);
  let total = 0;
  for (const f of files) {
    const text = readInput(f);
    const found = checkText(text, { profile, sources, posting, sent });
    total += found.length;
    const where = f === "-" ? "" : `${f}: `;
    for (const [kind, msg] of found) console.log(`${kind.padEnd(7)} ${where}${msg}`);
    if (!found.length) console.log(`clean   ${where}${numbersIn(withoutSalary(withoutDates(text))).length} numbers, ${sentences(text).length} sentences`);
  }
  return total ? 1 : 0;
}

if (isMainModule(import.meta.url)) await runMain(main);
