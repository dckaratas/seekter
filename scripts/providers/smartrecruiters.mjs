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
