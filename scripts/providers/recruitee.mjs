// Recruitee offers API. slug: the subdomain, as in <slug>.recruitee.com.
export default async function board(slug, net) {
  const d = await net.json(`https://${slug}.recruitee.com/api/offers/`);
  if (!d || !Array.isArray(d.offers)) return null;
  return d.offers.map((o) => ({ title: o.title,
    location: [o.location, o.remote ? "remote" : ""].filter(Boolean).join(" "), url: o.careers_url }));
}
