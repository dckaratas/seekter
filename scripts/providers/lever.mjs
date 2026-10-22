// Lever postings API, global and EU hosts. slug: as in jobs.lever.co/<slug>.
export default async function board(slug, net) {
  for (const host of ["api.lever.co", "api.eu.lever.co"]) {
    const d = await net.json(`https://${host}/v0/postings/${slug}?mode=json`);
    if (Array.isArray(d)) return d.map((j) => ({ title: j.text, location: (j.categories || {}).location ?? "", url: j.hostedUrl }));
  }
  return null;
}
