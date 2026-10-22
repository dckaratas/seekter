// Helpers the sweep and import scripts share. Node 20+, no packages.
import { pathToFileURL } from "node:url";
import { die } from "./seekter.mjs";

export const UA = "Mozilla/5.0 seekter";

let mock;
// GET a URL and return its body as text, or "" on any failure (like `curl -sS` did: the
// body of a 404 is still returned, a dead connection returns nothing). SEEKTER_HTTP names a
// module whose default export answers instead, which is how the tests run without the network.
export async function getText(url, timeoutSec = 40) {
  if (process.env.SEEKTER_HTTP) {
    mock ??= (await import(pathToFileURL(process.env.SEEKTER_HTTP).href)).default;
    return String((await mock(url)) ?? "");
  }
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutSec * 1000) });
    return await res.text();
  } catch {
    return "";
  }
}

export async function getJson(url, timeoutSec, fallback) {
  try { return JSON.parse(await getText(url, timeoutSec)); } catch { return fallback; }
}

// Run `fn` over `items` with at most `n` in flight; results keep the input order.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The profile's title filters were written for Python's `re`. Translate the few spellings
// JavaScript reads differently, and say which setting is broken rather than crash on it.
export function pyRegex(src, name) {
  const js = src.replace(/\(\?P</g, "(?<").replace(/\(\?P=(\w+)\)/g, "\\k<$1>").replace(/\\Z/g, "$(?![\\s\\S])").replace(/\\A/g, "^");
  try { return new RegExp(js, "i"); } catch (e) {
    die(`problem: ${name} in profile/settings.json is not a valid pattern: ${e.message}`);
  }
}

// json.dumps(obj) for a flat object: Python's default separators put a space after , and :.
export function pyDumps(obj) {
  return "{" + Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ") + "}";
}

// str() of a value the way Python would print it inside an f-string.
export function pyStr(v) {
  if (v === undefined || v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
  return String(v);
}
function pyRepr(v) {
  if (typeof v === "string") return v.includes("'") && !v.includes('"') ? `"${v}"` : `'${v.replace(/'/g, "\\'")}'`;
  return pyStr(v);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", bull: "•", middot: "·", copy: "©", reg: "®",
  trade: "™", euro: "€", pound: "£", times: "×", eacute: "é", egrave: "è", uuml: "ü", ouml: "ö", auml: "ä",
  ccedil: "ç", szlig: "ß" };
export function htmlUnescape(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}
