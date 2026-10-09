#!/usr/bin/env python3
"""Step 3 of a run, the cheap part: read the job boards of the employers on the
candidate's watchlist straight from their public ATS APIs, and the latest Hacker News
"Who is hiring?" thread. No browser, no login, no aggregator in between.

  python3 scripts/employer_sweep.py          # watchlist from `employers` in profile/settings.json
  python3 scripts/employer_sweep.py --hn     # this month's HN "Who is hiring?" thread

Postings are filtered with the profile's title_keep / title_drop and deduped against the
tracker. What is left still needs its location line read before anything is filled.
"""
import argparse, datetime as dt, html, json, re, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seekter  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
try:
    CFG = seekter.settings()
except ValueError as e:
    sys.exit(f"problem: profile/settings.json is not valid: {e}")
UA = "Mozilla/5.0 seekter"
OUT = seekter.ROOT / "runs" / seekter.TODAY
GAP = 1.0  # public APIs, but still one request after another (reference/sources/_core.md)


def curl(url):
    r = subprocess.run(["curl", "-sS", "-m", "30", "-A", UA, url],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    try:
        return json.loads(r.stdout)
    except Exception:
        return None


def greenhouse(slug):
    d = curl(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
    if not isinstance(d, dict) or "jobs" not in d:
        return None
    return [dict(title=j["title"], location=(j.get("location") or {}).get("name", ""),
                 url=f"https://job-boards.greenhouse.io/{slug}/jobs/{j['id']}") for j in d["jobs"]]


def ashby(slug):
    d = curl(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
    if not isinstance(d, dict) or "jobs" not in d:
        return None
    out = []
    for j in d["jobs"]:
        locs = [j.get("location") or ""] + [s.get("location", "") for s in j.get("secondaryLocations") or []]
        mode = j.get("workplaceType") or ""
        out.append(dict(title=j["title"], location=" / ".join(l for l in locs if l) + (f" ({mode})" if mode else ""),
                        url=j["jobUrl"]))
    return out


def lever(slug):
    for host in ("api.lever.co", "api.eu.lever.co"):
        d = curl(f"https://{host}/v0/postings/{slug}?mode=json")
        if isinstance(d, list):
            return [dict(title=j["text"], location=(j.get("categories") or {}).get("location", ""),
                         url=j["hostedUrl"]) for j in d]
    return None


def workable(slug):
    d = curl(f"https://apply.workable.com/api/v1/widget/accounts/{slug}")
    if not isinstance(d, dict) or "jobs" not in d:
        return None
    return [dict(title=j["title"], location=" ".join(x for x in (j.get("city"), j.get("country"),
                 "remote" if j.get("telecommuting") else "") if x),
                 url=f"https://apply.workable.com/{slug}/j/{j['shortcode']}") for j in d["jobs"]]


ATS = {"greenhouse": greenhouse, "ashby": ashby, "lever": lever, "workable": workable}


def title_filters():
    keep = CFG.get("title_keep") or ""
    if not keep:
        sys.exit("No title_keep in profile/settings.json yet. Run /seekter-init, or fill it in by hand.")
    return re.compile(keep, re.I), re.compile(CFG.get("title_drop") or r"(?!)", re.I)


def employers():
    keep, drop = title_filters()
    tracked = {r.get("job_key") for r in seekter.all_apps()}
    watch = CFG.get("employers") or []
    if not watch:
        sys.exit("No employers in profile/settings.json yet. Add {name, ats, slug} rows "
                 "(see templates/settings.json and reference/sources/direct-employer.md).")
    out, problems, seen = [], [], 0
    for i, e in enumerate(watch):
        fetch = ATS.get(e.get("ats", ""))
        jobs = fetch(e.get("slug", "")) if fetch else None
        if jobs is None:
            problems.append(f"{e.get('name')}: no board at {e.get('ats')}:{e.get('slug')}")
        else:
            seen += len(jobs)
            for j in jobs:
                if not keep.search(j["title"]) or drop.search(j["title"]):
                    continue
                if seekter.job_key(j["url"]) in tracked:
                    continue
                out.append(dict(company=e.get("name"), **j))
        if i < len(watch) - 1:
            time.sleep(GAP)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "employers.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(watch)} boards, {seen} postings → {len(out)} candidates  (runs/{seekter.TODAY}/employers.json)")
    for i, o in enumerate(out):
        print(f"{i:>2} | {o['company']} | {o['title']} | {o['location'][:60]} | {o['url']}")
    for p in problems:
        print("problem:", p)


def clean(text):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text or ""))).strip()


def hn():
    keep, drop = title_filters()
    hits = (curl("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5")
            or {}).get("hits", [])
    story = next((h for h in hits if (h.get("title") or "").startswith("Ask HN: Who is hiring?")), None)
    if not story:
        sys.exit("problem: could not find this month's 'Who is hiring?' thread")
    thread = curl(f"https://hn.algolia.com/api/v1/items/{story['objectID']}") or {}
    posts = [c for c in thread.get("children") or [] if c.get("text")]
    out = []
    for c in posts:
        raw = html.unescape(c["text"])
        text = clean(raw)
        # The first line of an HN job post is its header: company | role | location | type.
        if not keep.search(text) or (drop.search(text[:200]) and not keep.search(text[:200])):
            continue
        links = re.findall(r'href="([^"]+)"', raw)
        out.append(dict(id=c["id"], header=text[:200], remote=bool(re.search(r"\bremote\b", text, re.I)),
                        links=links[:3], url=f"https://news.ycombinator.com/item?id={c['id']}"))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "hn.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{story['title']}: {len(posts)} posts → {len(out)} mention the candidate's titles  (runs/{seekter.TODAY}/hn.json)")
    for i, o in enumerate(out):
        print(f"{i:>2} | {'R' if o['remote'] else '-'} | {o['header'][:150]} | {o['url']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--hn", action="store_true", help="read this month's HN 'Who is hiring?' thread instead")
    a = ap.parse_args()
    hn() if a.hn else employers()
