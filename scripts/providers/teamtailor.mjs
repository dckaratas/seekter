// Teamtailor career-site RSS. slug: the career site's host, either <co>.teamtailor.com or the
// company's own domain (jobs.lunar.app); every Teamtailor site serves /jobs.rss.
const tag = (block, name) => ((block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1] || "")
  .replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").trim();
export default async function board(slug, net) {
  const xml = await net.text(`https://${slug.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}/jobs.rss`);
  if (!/<rss/.test(xml)) return null;
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, b]) => {
    const places = [...b.matchAll(/<tt:name>([\s\S]*?)<\/tt:name>/g)].map((m) => m[1].trim());
    const remote = tag(b, "remoteStatus");
    return { title: tag(b, "title"), location: [...places, remote && remote !== "none" ? `remote: ${remote}` : ""].filter(Boolean).join(" / "),
      url: tag(b, "link") };
  });
}

// Is one posting still open? The job page answers 404 once it closes. Any host can be a
// Teamtailor site, so the host has to serve /jobs.rss first; on any other site a 404 would say
// nothing about Teamtailor.
export async function live(url, net) {
  const m = url.match(/\/\/([^/]+)\/jobs\/(\d+)-[^?#]*/i);
  if (!m) return null;
  if (!/<rss/.test(await net.text(`https://${m[1]}/jobs.rss`))) return null;
  const r = await net.status(`https://${m[0].slice(2)}`);
  return r.status === 200 ? "open" : r.status === 404 ? "closed" : null;
}
