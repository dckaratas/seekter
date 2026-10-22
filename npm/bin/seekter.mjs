#!/usr/bin/env node
// npx seekter init [folder]: puts the newest Seekter release in a folder, ready for Claude Code.
// Node 20+, no packages. It reads one release from GitHub and unpacks it with the `tar` every
// supported system ships (macOS, Linux, Windows 10 and later). Nothing else is downloaded, nothing
// is sent anywhere, and nothing outside the target folder is written apart from one temp file.
//
//   npx seekter init                # into ./seekter
//   npx seekter init my-search      # into ./my-search
//   npx seekter init . --from seekter.tar.gz   # unpack a release archive you already have
//
// The kit lives at https://github.com/selfishprimate/seekter. This package is only the way in:
// the skills, scripts and references come from the release itself, so they are the same files a
// clone or the seekter.zip download would give.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = "selfishprimate/seekter";
const PRIVATE = ["profile", "applications", "runs"];
const VERSION = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).version;

const USAGE = `usage: npx seekter init [folder] [--from <release.tar.gz>]

  init [folder]   Put the newest Seekter release in ./seekter, or in the folder you name.
                  The folder must be new or empty.
  --from <file>   Unpack this release archive instead of downloading one.
  --version       Print this package's version.`;

class Exit extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}
const die = (message, code = 1) => { throw new Exit(message, code); };

function parse(argv) {
  const out = { cmd: null, folder: null, from: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") { out.from = argv[++i] ?? die(`--from needs a file\n\n${USAGE}`, 2); continue; }
    if (a === "-h" || a === "--help" || a === "help") { out.cmd = "help"; continue; }
    if (a === "-v" || a === "--version") { out.cmd = "version"; continue; }
    if (a.startsWith("-")) die(`unknown option ${a}\n\n${USAGE}`, 2);
    if (!out.cmd) out.cmd = a;
    else if (!out.folder) out.folder = a;
    else die(`too many arguments\n\n${USAGE}`, 2);
  }
  return out;
}

// The folder may not exist yet, or may exist and be empty. Anything in it is somebody's.
function prepare(folder) {
  if (fs.existsSync(folder)) {
    if (!fs.statSync(folder).isDirectory()) die(`${folder} exists and is not a folder`);
    if (fs.readdirSync(folder).length) die(`${folder} is not empty. Pick a new folder, or empty this one first.`);
  } else fs.mkdirSync(folder, { recursive: true });
}

async function latestRelease() {
  const headers = { "User-Agent": `seekter-npm/${VERSION}`, Accept: "application/vnd.github+json" };
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers, signal: AbortSignal.timeout(30000) });
  if (!r.ok) die(`GitHub answered ${r.status} for the latest release. Try again later, or download seekter.zip from https://github.com/${REPO}/releases/latest`);
  const rel = await r.json();
  return { tag: rel.tag_name, tarball: rel.tarball_url };
}

async function download(url, file) {
  const r = await fetch(url, { headers: { "User-Agent": `seekter-npm/${VERSION}` }, redirect: "follow", signal: AbortSignal.timeout(120000) });
  if (!r.ok) die(`the release archive answered ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

// GitHub's archive has one top folder (owner-repo-sha); the kit goes straight into the target.
// The archive goes in on stdin and the folder is the working directory: given a path such as
// C:\Users\..., the GNU tar that Git for Windows puts on the PATH reads "C:" as a remote host.
function unpack(archive, folder) {
  const p = spawnSync("tar", ["-xzf", "-", "--strip-components=1"], { cwd: folder, input: fs.readFileSync(archive), maxBuffer: 1 << 26 });
  if (p.error) die(`could not run tar (${p.error.code}). It ships with macOS, Linux and Windows 10 or later.`);
  if (p.status !== 0) die(`tar could not unpack the release: ${String(p.stderr || "").trim()}`);
}

// A release never carries anything of a candidate's, but this is the folder they will put
// their CV in, so check rather than assume, the way the release workflow does.
function check(folder) {
  if (!fs.existsSync(path.join(folder, ".claude", "skills"))) die("the archive does not look like a Seekter release (no .claude/skills)");
  for (const p of PRIVATE) {
    const dir = path.join(folder, p);
    fs.mkdirSync(dir, { recursive: true });
    const stray = fs.readdirSync(dir).filter((f) => f !== ".gitkeep");
    if (stray.length) die(`the release carried files under ${p}/ (${stray.join(", ")}). Not using it; please report this at https://github.com/${REPO}/issues`);
  }
}

async function init(a) {
  const folder = path.resolve(a.folder || "seekter");
  prepare(folder);
  let tag = null;
  try {
    if (a.from) {
      if (!fs.existsSync(a.from)) die(`no such file: ${a.from}`);
      unpack(path.resolve(a.from), folder);
    } else {
      const rel = await latestRelease();
      tag = rel.tag;
      process.stdout.write(`Downloading Seekter ${tag} ...\n`);
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seekter-")), "release.tar.gz");
      try {
        await download(rel.tarball, tmp);
        unpack(tmp, folder);
      } finally {
        fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
      }
    }
    check(folder);
  } catch (e) {
    // Leave nothing half-unpacked behind in a folder this command created or found empty.
    fs.rmSync(folder, { recursive: true, force: true });
    throw e;
  }
  const rel = path.relative(process.cwd(), folder) || ".";
  console.log(`Seekter${tag ? ` ${tag}` : ""} is in ${rel}

Before you start:
  - Applications go out in your name, from your browser. You are responsible for what they say.
  - Job sites and application systems have their own terms; following them is yours to do.
  - Seekter is free, but it runs on your own paid Claude plan or API account.
  Read DISCLAIMER.md in the folder for the whole of it.

Next:
  cd ${rel}
  claude
  /seekter-init

You need Claude Code, the Claude in Chrome extension and Node.js 20 or newer.`);
  return 0;
}

async function main() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 20) die(`Seekter needs Node.js 20 or newer; this is ${process.versions.node}.`);
  const a = parse(process.argv.slice(2));
  if (a.cmd === "version") { console.log(VERSION); return 0; }
  if (!a.cmd || a.cmd === "help") { console.log(USAGE); return a.cmd ? 0 : 2; }
  if (a.cmd === "init") return init(a);
  die(`unknown command ${a.cmd}\n\n${USAGE}`, 2);
}

main().then((code) => { process.exitCode = code; }, (e) => {
  if (e instanceof Exit) { process.stderr.write(`seekter: ${e.message}\n`); process.exitCode = e.code; }
  else { process.stderr.write(`seekter: ${e.stack || e}\n`); process.exitCode = 1; }
});
