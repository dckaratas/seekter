// Greenhouse job board API. slug: the board token, as in job-boards.greenhouse.io/<slug>.
export default async function board(slug, net) {
  const d = await net.json(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
  if (!d || !Array.isArray(d.jobs)) return null;
  return d.jobs.map((j) => ({ title: j.title, location: (j.location || {}).name ?? "",
    url: `https://job-boards.greenhouse.io/${slug}/jobs/${j.id}` }));
}
