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
