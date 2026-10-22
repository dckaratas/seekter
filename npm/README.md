# seekter

Sets up [Seekter](https://seekter.dev), an open-source job-search kit for Claude Code. It searches job sources, filters postings against your own rules, fills application forms in your own Chrome, and keeps the tracker as markdown files on your machine.

```bash
npx seekter init
cd seekter
claude
```

Then, inside Claude Code, run `/seekter-init`.

`init` downloads the newest release from [GitHub](https://github.com/selfishprimate/seekter/releases/latest) and unpacks it into `./seekter`, or into the folder you name (`npx seekter init my-search`). The folder must be new or empty. Nothing else is installed: the kit has no dependencies, and this package has none either.

You need Claude Code, the Claude in Chrome extension and Node.js 20 or newer. Seekter is free; running it is not, because it runs on your own paid Claude plan or API account.

Applications go out in your name. Read [DISCLAIMER.md](https://github.com/selfishprimate/seekter/blob/main/DISCLAIMER.md) before the first run.

MIT licensed.
