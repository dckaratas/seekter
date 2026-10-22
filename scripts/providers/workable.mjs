// Workable widget API. slug: the account, as in apply.workable.com/<slug>.
export default async function board(slug, net) {
  const d = await net.json(`https://apply.workable.com/api/v1/widget/accounts/${slug}`);
  if (!d || !Array.isArray(d.jobs)) return null;
  return d.jobs.map((j) => ({ title: j.title,
    location: [j.city, j.country, j.telecommuting ? "remote" : ""].filter(Boolean).join(" "),
    url: `https://apply.workable.com/${slug}/j/${j.shortcode}` }));
}

// Is one posting still open? Workable's job endpoint answers 404 once the job is gone.
export async function live(url, net) {
  const m = url.match(/apply\.workable\.com\/([^/?#]+)\/j\/(\w+)/i);
  if (!m) return null;
  const r = await net.status(`https://apply.workable.com/api/v2/accounts/${m[1]}/jobs/${m[2]}`);
  if (r.status === 404) return "closed";
  if (r.status !== 200) return null;
  // The job answers with its state; only "published" takes applications. A state the check
  // does not know is not proof either way.
  let d = null;
  try { d = JSON.parse(r.body); } catch { d = null; }
  if (!d || d.state === undefined || d.state === "published") return "open";
  return /^(closed|archived)$/i.test(d.state) ? "closed" : null;
}
