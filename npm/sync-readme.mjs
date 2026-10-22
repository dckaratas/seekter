#!/usr/bin/env node
// Writes npm/README.md from the repository's README.md, so the npm page shows the same text as
// GitHub. Run it before every `npm publish` from this folder: npm shows the README packed into the
// latest version, never the repository's, and a page can only change by publishing.
//
//   node npm/sync-readme.mjs
//
// The npm page resolves nothing relative to the repository, so links to files become GitHub links,
// images become raw.githubusercontent.com addresses, and GitHub's own alert syntax ("> [!NOTE]"),
// which npm prints as text, is dropped. Not shipped: package.json lists only bin/ and README.md,
// and the name must not start with "readme", because npm packs any such file whatever `files`
// says (0.11.1 carried this script as readme.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BLOB = "https://github.com/selfishprimate/seekter/blob/main/";
const RAW = "https://raw.githubusercontent.com/selfishprimate/seekter/main/";

const INTRO = `> **This package installs Seekter.** \`npx seekter init\` puts the newest release in \`./seekter\` (or the folder you name); then open Claude Code there and run \`/seekter-init\`. The package has no dependencies. Everything below is the project's README.

`;

const relative = (p) => !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(p);

// The note goes under the title block (cover image, heading, version badge), so the page still
// opens on the picture; with no badge line it goes first.
export function npmReadme(text) {
  // A Windows checkout has CRLF line endings, and "." does not match "\r", so the title block
  // would not be found; the page is written with LF either way.
  const out = String(text).replace(/\r\n/g, "\n")
    // Images: markdown and HTML.
    .replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (m, a, p, b) => (relative(p) ? a + RAW + p.replace(/^\.\//, "") + b : m))
    .replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/g, (m, a, p, b) => (relative(p) ? a + RAW + p.replace(/^\.\//, "") + b : m))
    // Links to files in the repository.
    .replace(/(\]\()([^)\s]+)(\))/g, (m, a, p, b) => (relative(p) ? a + BLOB + p.replace(/^\.\//, "") + b : m))
    // GitHub alerts: npm would print "[!IMPORTANT]" literally; the quote around it stays.
    .replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n/gm, "");
  const badge = out.match(/^\[!\[version\].*\n\n?/m);
  if (!badge) return INTRO + out;
  const at = badge.index + badge[0].length;
  return out.slice(0, at) + INTRO + out.slice(at);
}

function main() {
  const src = fs.readFileSync(path.join(HERE, "..", "README.md"), "utf8");
  fs.writeFileSync(path.join(HERE, "README.md"), npmReadme(src));
  console.log("npm/README.md written from README.md");
}

if (process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) main();
