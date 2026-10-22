// Ashby posting API. slug: the board name, as in jobs.ashbyhq.com/<slug>.
export default async function board(slug, net) {
  const d = await net.json(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
  if (!d || !Array.isArray(d.jobs)) return null;
  return d.jobs.map((j) => {
    const locs = [j.location || "", ...(j.secondaryLocations || []).map((s) => s.location ?? "")];
    const mode = j.workplaceType || "";
    return { title: j.title, location: locs.filter(Boolean).join(" / ") + (mode ? ` (${mode})` : ""), url: j.jobUrl };
  });
}
