// Workday's public job search (the endpoint its own career site calls). It searches rather than
// lists, so it runs one search per profile query, 20 results a page, three pages at most.
// slug: "<tenant>.<wdN>/<site>", read off a posting URL: cloudera.wd5.myworkdayjobs.com/External_Career
// → "cloudera.wd5/External_Career".
const PAGE = 20, PAGES = 3;
export default async function board(slug, net) {
  const m = String(slug).match(/^([\w-]+)\.(wd\d+)\/([\w-]+)$/);
  if (!m) return null;
  const [, tenant, wd, site] = m, host = `https://${tenant}.${wd}.myworkdayjobs.com`;
  const seen = new Map();
  let reachable = false;
  for (const q of net.queries.length ? net.queries : [""]) {
    for (let page = 0; page < PAGES; page++) {
      const d = await net.json(`${host}/wday/cxs/${tenant}/${site}/jobs`, { appliedFacets: {}, limit: PAGE, offset: page * PAGE, searchText: q });
      if (!d || !Array.isArray(d.jobPostings)) break;
      reachable = true;
      for (const j of d.jobPostings) {
        if (!j.externalPath || seen.has(j.externalPath)) continue;
        seen.set(j.externalPath, { title: j.title, location: [j.locationsText, j.remoteType].filter(Boolean).join(" · "),
          url: `${host}/en-US/${site}${j.externalPath}` });
      }
      if ((page + 1) * PAGE >= (d.total ?? 0)) break;
    }
  }
  return reachable ? [...seen.values()] : null;
}
