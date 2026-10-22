// SmartRecruiters public postings API, paged 100 at a time. slug: the company identifier, as
// in jobs.smartrecruiters.com/<slug>/<id> (case matters: "ScalableGmbH", "IFS1").
const PAGE = 100, MAX = 1000;
export default async function board(slug, net) {
  const out = [];
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const d = await net.json(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=${PAGE}&offset=${offset}`);
    if (!d || !Array.isArray(d.content)) return offset ? out : null;
    for (const p of d.content) {
      const l = p.location || {};
      out.push({ title: (p.name || "").trim(),
        location: [l.city, (l.country || "").toUpperCase(), l.remote ? "remote" : ""].filter(Boolean).join(" "),
        url: `https://jobs.smartrecruiters.com/${slug}/${p.id}` });
    }
    if (offset + PAGE >= (d.totalFound ?? 0)) break;
  }
  // A company id that does not exist answers 200 with an empty list, so a wrong slug looks like
  // a board with nothing open. The sweep prints the count per board; zero for a large employer
  // is the sign to check the slug.
  return out;
}

// Is one posting still open? The posting endpoint answers 404 once it is gone; other errors
// (a mistyped company id answers 400) say nothing. A posting can also still answer 200 with
// "active": false, so the flag decides when it is there.
export async function live(url, net) {
  const m = url.match(/jobs\.smartrecruiters\.com\/([^/?#]+)\/(\d+)/i);
  if (!m) return null;
  const r = await net.status(`https://api.smartrecruiters.com/v1/companies/${m[1]}/postings/${m[2]}`);
  if (r.status === 404) return "closed";
  if (r.status !== 200) return null;
  let d = null;
  try { d = JSON.parse(r.body); } catch { d = null; }
  return d && d.active === false ? "closed" : "open";
}
