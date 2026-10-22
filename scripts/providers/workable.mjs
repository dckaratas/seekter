// Workable widget API. slug: the account, as in apply.workable.com/<slug>.
export default async function board(slug, net) {
  const d = await net.json(`https://apply.workable.com/api/v1/widget/accounts/${slug}`);
  if (!d || !Array.isArray(d.jobs)) return null;
  return d.jobs.map((j) => ({ title: j.title,
    location: [j.city, j.country, j.telecommuting ? "remote" : ""].filter(Boolean).join(" "),
    url: `https://apply.workable.com/${slug}/j/${j.shortcode}` }));
}
