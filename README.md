# verslas.ai content pipeline

Researches AI topics and writes original, fact-checked Lithuanian articles for
[verslas.ai](https://www.verslas.ai). Articles reach the site only as pull
requests into `mykolas268-jpg/verslas`; nothing is ever merged automatically.

- Plan, decisions and phase status: [`docs/PLAN.md`](docs/PLAN.md)
- Site audit and metrics baseline: [`reports/`](reports/)

## Status

| Phase | State |
| --- | --- |
| 1. Site readiness | Code in [verslas#2](https://github.com/mykolas268-jpg/verslas/pull/2) (waiting for merge); Vercel settings deferred to the last phase |
| 2. Vertical slice: `article --topic` → fact sheet → writer → all gates → shadow PR | **Built; needs `ANTHROPIC_API_KEY` + `SITE_REPO_TOKEN` to run for real** |
| 3. Ingest, scoring, daily brief | Not started |
| 4. Approval mode, notifications, IndexNow on publish | IndexNow workflow is in verslas#2; the rest is not started |
| 5. Refresh, roundup, weekly report, GSC loop | Not started |

## How an article is made

```
topic ─► research (Sonnet 5 + web_search/web_fetch)
      ─► fact sheet (structured; URLs must have been retrieved; ≥1 primary or 2 independent sources)
      ─► writer (Opus 5.5, from the fact sheet only) ─► Lithuanian copy editor (Opus 5.5)
      ─► gates: Lithuanian (Hunspell + rules) · SEO · structure/MDX safety · link allowlist
               · independent fact-check (Sonnet 5) + number check · links resolve
      ─► up to 2 revision loops ─► .mdx + PR body (claim table first)
      ─► verify job: site's `check:content --strict` + full build (no secrets)
      ─► draft PR labelled `shadow` + `pipeline` (Vercel builds a preview)
```

Models only return data. All git, HTTP and PR work is deterministic code.

## Setup (one time)

1. **Secrets** (this repo → Settings → Secrets and variables → Actions):
   - `ANTHROPIC_API_KEY` — from platform.claude.com. Also set a monthly spend
     limit on that workspace in the Console as a second stop.
   - `SITE_REPO_TOKEN` — fine-grained personal access token, repository
     access **only** `mykolas268-jpg/verslas`, permissions: Contents RW, Pull
     requests RW, Issues RW (labels), Metadata R. Set an expiry and a reminder.
2. **Variables**: `PIPELINE_PAUSED` = `false` (set `true` to stop everything).
3. Nothing else: the `state` branch is created on the first run.

## Running

- **On GitHub (normal):** Actions → *Article (shadow)* → Run workflow → a topic
  or a backlog number. Result: a draft PR in the site repo with a preview
  link, or run artifacts explaining why it stopped.
- **Locally:**

```bash
npm ci
sudo apt-get install hunspell hunspell-lt   # Lithuanian spelling (optional locally)
git clone https://github.com/mykolas268-jpg/verslas site

# offline, no API calls, no cost:
npm run pipeline -- article --topic "ExampleVideo 2.0 (testas)" --type news \
  --cluster di-irankiai --keyword "AI video įrankis" \
  --site test/fixtures/site --fixtures test/fixtures/article --dry-run

# real run (spends money; caps in config/config.yml):
ANTHROPIC_API_KEY=… npm run pipeline -- article --backlog 1 --site site --dry-run
```

Exit codes: 0 ready · 3 gates still failing after revisions · 4 aborted
(e.g. not enough verified facts, never-cover topic) · 1 error (including a
cost cap).

## Configuration (`config/`)

| File | What to edit |
| --- | --- |
| `config.yml` | mode, model IDs, prices, **cost caps**, cadence, research limits, length targets |
| `topics.yml` | clusters and the CTA each may use |
| `style-guide.lt.md` | voice, structure and the Lithuanian checklist |
| `glossary.yml` | preferred terms; words Hunspell doesn't know |
| `banned-phrases.yml` | phrases that fail the Lithuanian gate |
| `backlog.yml` | your topic ideas (`--backlog <n>`) |
| `never-cover.yml` | topics never to write about |
| `test-questions.yml` | 20 questions for the monthly AI-assistant citation check |

## Safety rails

- **Cost caps** (per run, per article, monthly) are checked before every call
  against the call's worst case; the ledger is `state/costs.jsonl`; an
  unreadable ledger stops the run.
- **Kill switch:** `PIPELINE_PAUSED=true` (repo variable or env).
- **Untrusted content:** fetched pages reach only the research step; the
  writer sees the validated fact sheet; outbound links must come from the
  fact sheet; MDX may contain only `Callout`/`ProseImage`, no JS expressions.
- **Shadow mode** is the only mode until Phase 4: PRs are drafts labelled
  `shadow` and are never merged.

## Development

```bash
npm run typecheck
npm test
```

See [`CLAUDE.md`](CLAUDE.md) for maintenance notes.
