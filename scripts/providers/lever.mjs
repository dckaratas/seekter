// Lever postings API, global and EU hosts. slug: as in jobs.lever.co/<slug>.
export default async function board(slug, net) {
  for (const host of ["api.lever.co", "api.eu.lever.co"]) {
    const d = await net.json(`https://${host}/v0/postings/${slug}?mode=json`);
    if (Array.isArray(d)) return d.map((j) => ({ title: j.text, location: (j.categories || {}).location ?? "", url: j.hostedUrl }));
  }
  return null;
}

// Is one posting still open? The postings API answers 404 "Document not found" once it closes,
// but also for a confidential posting, which Lever leaves out of the public API while it is
// open (career-ops measured this on 9 Aug 2026). So a 404 there is asked again of the hosted
// job page, which answers 200 for an open posting and 404 for a gone one.
export async function live(url, net) {
  const m = url.match(/jobs\.(eu\.)?lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const r = await net.status(`https://api.${m[1] || ""}lever.co/v0/postings/${m[2]}/${m[3]}`);
  if (r.status === 200) return "open";
  if (r.status !== 404) return null;
  const page = await net.status(`https://jobs.${m[1] || ""}lever.co/${m[2]}/${m[3]}`);
  return page.status === 200 ? "open" : page.status === 404 ? "closed" : null;
}
