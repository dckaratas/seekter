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

// Is one posting still open? Not from the board list: a posting can be open and unlisted, and
// the list leaves it out. Measured 22 Oct 2026: a posting missing from its company's board
// served its page normally. The job page itself embeds the posting, or `"posting":null` once
// it is gone. Returns "open", "closed", or null when the URL is not Ashby's or the page is unclear.
export async function live(url, net) {
  const m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const r = await net.status(`https://jobs.ashbyhq.com/${m[1]}/${m[2]}`);
  if (r.status !== 200) return r.status === 404 ? "closed" : null;
  if (/"posting":null/.test(r.body)) return "closed";
  return /"posting":\{"id":/.test(r.body) ? "open" : null;
}
