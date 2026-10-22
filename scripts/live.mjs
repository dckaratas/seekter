#!/usr/bin/env node
// Is a posting still open? Asks the application system's own public API, right before a form is
// opened, so a closed posting costs one request instead of a filled form.
//
//   node scripts/live.mjs <url> [<url> ...]        # or one URL per line on stdin
//
// Prints one line per URL: OPEN, CLOSED or UNKNOWN, with the system that answered. Only CLOSED
// is a reason to skip: UNKNOWN means no provider knows the URL (a company's own careers page,
// LinkedIn, which is never called) or the system's answer was not clear, and the run goes on to
// read the posting itself. Exit code 3 when every URL given is CLOSED, so a single check can
// be tested in a shell; 0 otherwise.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runMain, isMainModule, settings } from "./seekter.mjs";
import { fetchResult, getJson, getText } from "./_shared.mjs";

const PROVIDERS = path.join(path.dirname(fileURLToPath(import.meta.url)), "providers");

export function net() {
  let queries = [];
  try { queries = (settings().freehire || {}).queries || []; } catch { queries = []; }
  return { json: (url, post = null) => getJson(url, 30, null, post), text: (url) => getText(url, 30),
    status: (url, post = null) => fetchResult(url, 30, post), queries };
}

// Every provider that exports live(): each one says null for a URL that is not its own.
export async function liveness(url, n = net()) {
  if (/linkedin\.com/i.test(url)) return { state: "UNKNOWN", by: "linkedin is never called" };
  for (const f of fs.readdirSync(PROVIDERS).filter((x) => x.endsWith(".mjs")).sort()) {
    const mod = await import(pathToFileURL(path.join(PROVIDERS, f)).href);
    if (typeof mod.live !== "function") continue;
    let state = null;
    try { state = await mod.live(url, n); } catch { state = null; }
    if (state === "open") return { state: "OPEN", by: f.replace(/\.mjs$/, "") };
    if (state === "closed") return { state: "CLOSED", by: f.replace(/\.mjs$/, "") };
  }
  return { state: "UNKNOWN", by: "no provider could tell" };
}

async function main() {
  let urls = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!urls.length) {
    let input = "";
    try { input = fs.readFileSync(0, "utf8"); } catch { input = ""; }
    urls = input.split(/\r?\n/).map((l) => l.split("|")[0].trim()).filter(Boolean);
  }
  if (!urls.length) { console.error("usage: node scripts/live.mjs <url> [<url> ...]"); return 2; }
  const n = net();
  let closed = 0;
  for (const u of urls) {
    const r = await liveness(u, n);
    if (r.state === "CLOSED") closed++;
    console.log(`${r.state.padEnd(8)} ${u}  (${r.by})`);
  }
  return closed === urls.length ? 3 : 0;
}

if (isMainModule(import.meta.url)) await runMain(main);
