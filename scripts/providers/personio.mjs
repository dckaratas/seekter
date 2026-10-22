// Personio public XML feed. slug: the subdomain, as in <slug>.jobs.personio.de (or .com).
const tag = (block, name) => ((block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1] || "")
  .replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
export default async function board(slug, net) {
  for (const tld of ["de", "com"]) {
    const xml = await net.text(`https://${slug}.jobs.personio.${tld}/xml`);
    if (!/<workzag-jobs/.test(xml)) continue;
    return [...xml.matchAll(/<position>([\s\S]*?)<\/position>/g)].map(([, b]) => ({
      title: tag(b, "name"),
      location: [tag(b, "office"), ...[...b.matchAll(/<additionalOffice>([\s\S]*?)<\/additionalOffice>/g)].map((m) => m[1].trim())]
        .filter(Boolean).join(" / "),
      url: `https://${slug}.jobs.personio.${tld}/job/${tag(b, "id")}` }));
  }
  return null;
}
