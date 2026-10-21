#!/usr/bin/env node
// Import an existing tracker (Notion, Airtable, Google Sheets, any CSV) into
// applications/<YYYY-MM>/.
//
//   node scripts/import_csv.mjs path/to/export.csv [--dry-run]
//
// Column names are matched loosely (Position/Role/Title, Company, Status, Job URL/URL,
// Applied on/Date, Source, Apply type, Location fit, Remote scope, Fit score, Posted,
// Why it fits, Notes). Rows that point at the same posting are merged into one file:
// the most advanced status wins and the other rows' notes are appended.
import fs from "node:fs";
import { TODAY, jobKey, slug, save, bodyFor, cmdIndex, runMain, parseArgs } from "./seekter.mjs";

const STATUS_MAP = {
  shortlisted: "pending", pending: "pending", "to apply": "pending", draft: "pending",
  applied: "applied", submitted: "applied",
  screening: "interviewing", interview: "interviewing", interviewing: "interviewing",
  offer: "offer", rejected: "rejected", declined: "rejected",
  "no response": "closed", ghosted: "closed", withdrawn: "closed", closed: "closed",
  skipped: "skipped", skip: "skipped",
};
const RANK = { offer: 7, interviewing: 6, rejected: 5, applied: 4, closed: 3, pending: 2, skipped: 1 };
const ALIASES = {
  role: ["position", "role", "title", "job title", "name"],
  company: ["company", "employer"],
  status: ["status", "stage"],
  url: ["job url", "url", "link", "posting"],
  applied: ["applied on", "applied", "date applied", "date"],
  updated: ["last update", "updated"],
  posted: ["posted", "posted on"],
  source: ["source"],
  apply_type: ["apply type", "method"],
  location_fit: ["location fit", "location"],
  remote_scope: ["remote scope", "remote"],
  fit: ["fit score", "fit"],
  why: ["why it fits", "why"],
  notes: ["notes", "comments"],
};

// RFC 4180: quoted fields may hold commas, doubled quotes and line breaks.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false, i = 0;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ",") { pushField(); i++; continue; }
    if (c === "\r" && text[i + 1] === "\n") { pushRow(); i += 2; continue; }
    if (c === "\n" || c === "\r") { pushRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

// csv.DictReader: the first row names the columns; a short row leaves the rest empty.
function dictRows(text) {
  const [header = [], ...rest] = parseCsv(text.replace(/^﻿/, ""));
  return rest.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? null])));
}

function pick(row, field) {
  const low = {};
  for (const [k, v] of Object.entries(row)) if (k) low[k.trim().toLowerCase().replace(/^﻿+/, "")] = v;
  for (const name of ALIASES[field]) {
    if (name in low && low[name] !== null && low[name] !== "") return low[name].trim();
  }
  return "";
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
  "november", "december"];

function isoIfReal(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// The strptime formats the Python version tried, in the same order.
const FORMATS = [
  [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (m) => [+m[1], +m[2], +m[3]]],
  [/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/, (m) => [+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]]],
  [/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/, (m) => [+m[3], MONTHS.findIndex((x) => x.slice(0, 3) === m[1].toLowerCase()) + 1, +m[2]]],
  [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (m) => [+m[3], +m[2], +m[1]]],
  [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (m) => [+m[3], +m[1], +m[2]]],
  [/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, (m) => [+m[3], +m[2], +m[1]]],
  [/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (m) => [+m[1], +m[2], +m[3]]],
];

function date(s) {
  s = (s || "").trim();
  if (!s) return "";
  s = s.split(/\s*(?:→|->)\s*/)[0];
  s = s.replace(/\s+\d{1,2}:\d{2}.*$/s, "");
  for (const [re, parts] of FORMATS) {
    const m = s.match(re);
    if (!m) continue;
    const [y, mo, d] = parts(m);
    if (mo < 1) continue;
    const iso = isoIfReal(y, mo, d);
    if (iso) return iso;
  }
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
}

function fitCode(s) {
  const m = (s || "").match(/^\s*([ABCX])\b/);
  return m ? m[1] : s || "";
}

function main() {
  const a = parseArgs(process.argv.slice(2), { usage: "node scripts/import_csv.mjs csv [--dry-run]",
    positional: ["csv"], options: { "dry-run": { flag: true } } });
  const raw = dictRows(fs.readFileSync(a.csv, "utf8"));
  const groups = new Map();
  for (const row of raw) {
    const r = Object.fromEntries(Object.keys(ALIASES).map((f) => [f, pick(row, f)]));
    if (!(r.company || r.role)) continue;
    r.status = STATUS_MAP[r.status.toLowerCase()] ?? "pending";
    for (const f of ["applied", "updated", "posted"]) r[f] = date(r[f]);
    r.location_fit = fitCode(r.location_fit);
    const key = jobKey(r.url) || `${slug(r.company)}|${slug(r.role)}|${r.applied}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  let made = 0;
  for (const rs of groups.values()) {
    rs.sort((x, y) => RANK[y.status] - RANK[x.status]);
    const top = rs[0];
    const notes = [top.notes, ...rs.slice(1).filter((o) => o.notes).map((o) => `(merged row, status ${o.status}) ${o.notes}`)];
    const latest = rs.map((o) => o.applied || o.updated).reduce((x, y) => (y > x ? y : x), "");
    const when = top.applied || top.updated || latest || TODAY;
    if (a.dry_run) {
      console.log(`${top.status.padEnd(12)} ${when} ${top.company} | ${top.role}` + (rs.length > 1 ? `  (+${rs.length - 1} merged)` : ""));
      made++;
      continue;
    }
    const meta = { company: top.company, role: top.role || "(untitled)", status: top.status, url: top.url,
      source: top.source, apply_type: top.apply_type, location_fit: top.location_fit, remote_scope: top.remote_scope,
      fit: top.fit, posted: top.posted, applied: ["pending", "skipped"].includes(top.status) ? "" : top.applied,
      updated: top.updated || when, job_key: jobKey(top.url) };
    const notesTxt = notes.filter(Boolean).join("\n\n");
    if (meta.status === "skipped") {
      meta.notes = notesTxt || top.why;
      save(meta);
    } else {
      save(meta, bodyFor(meta.role, meta.company, top.why, notesTxt, "", `- ${when}: ${top.status} (imported)`));
    }
    made++;
  }
  console.log(`${raw.length} rows → ${made} files` + (a.dry_run ? " (dry run)" : ""));
  if (!a.dry_run) cmdIndex(null);
  return 0;
}

await runMain(main);
