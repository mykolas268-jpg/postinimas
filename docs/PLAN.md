# verslas.ai content pipeline — Phase 0 plan

Status: **draft, waiting for owner approval** (Phase 0, step D).
Date: 2026-09-24. Nothing in this document has been built yet.

Legend used throughout:

- **[verified]** — checked directly in this session (repo files, a local build, DNS, or official docs).
- **[inferred]** — a conclusion from indirect evidence; likely, not proven.
- **[unverified]** — could not be checked from this environment; needs the owner or a later phase.
- **[opinion]** — my recommendation or judgement, not a fact.

---

## 1. Discovery findings

### 1.1 The spec's stack assumptions are wrong

| Spec assumed | Reality | Evidence |
| --- | --- | --- |
| Astro + Tailwind, Astro content collection | **Next.js 15.5 (App Router, SSG) + React 19 + Tailwind 3.4** | `package.json` in `mykolas268-jpg/verslas` [verified] |
| Articles in `src/content/straipsniai/` | **`content/straipsniai/*.mdx`**, compiled with `next-mdx-remote/rsc` | `lib/posts.ts` [verified] |
| Hosting: Cloudflare Pages or Vercel | **Vercel.** `www.verslas.ai` is a CNAME to `cname.vercel-dns.com`; the apex resolves to `216.198.79.1` (Vercel's A record). No Cloudflare proxy in front. | DNS lookup from this session [verified]; "Vercel's A record" and "no Cloudflare proxy" [inferred] |
| Pipeline in `pipeline/` inside the site repo | The repo assigned to this work, `mykolas268-jpg/postinimas`, is **empty and separate** from the site repo `mykolas268-jpg/verslas` | [verified] |

`mykolas268-jpg/verslas-ai` (private) is a different product (a quiz and paywall funnel built on Stripe and Supabase). It is not the blog. [verified]

### 1.2 Site repo (`mykolas268-jpg/verslas`, commit `b1d0e19`, 2026-09-11)

- **Build:** `npm run build` passes locally. All article routes are prerendered (SSG). [verified]
- **Scripts:** `lint`, `typecheck` and a Playwright smoke suite (`test:e2e`). **No CI at all**: there is no `.github/`, so nothing checks PRs before Vercel builds them. [verified]
- **Frontmatter schema** (Zod, `lib/posts.ts`): `title`, `slug` (ASCII kebab-case), `date` (YYYY-MM-DD), `excerpt` (used as the meta description), `tags[]`, `cover?`, `draft`. The schema is a plain `z.object`, so **unknown keys are stripped, not rejected**. New optional fields therefore cannot break the build. [verified]
- **Missing from the schema:** updated date, author, article type, sources, FAQ. So `dateModified` is always the same as `datePublished`. [verified]
- **MDX components:** `<Callout type="info|tip|warning|sample" title?>` and `<ProseImage src alt caption?>`. Code blocks support `title="…"`. [verified]
- **SEO head** (`app/straipsniai/[slug]/page.tsx`): the page has a canonical URL, OG and Twitter tags, and a dynamic 1200×630 OG PNG per article (`next/og`, Inter latin-ext font, branded teal template). JSON-LD is `BlogPosting` with author set to **Organization "verslas.ai komanda"**. `inLanguage` is `"lt"`. The JSON-LD image is the SVG cover. There is no BreadcrumbList, no Organization/WebSite schema on the home page, and no `citation`. [verified]
- **Title tags:** the template appends ` · verslas.ai`. **All 4 articles exceed 60 characters (75–101).** [verified]
- **Meta descriptions:** 153–181 characters. The price article's 181 characters will be truncated. [verified]
- **sitemap.xml:** article `lastmod` comes from `date`. Static routes have no `lastmod`. `changefreq` and `priority` are set, but Google ignores both. [verified]
- **robots.txt:** `User-agent: * / Allow: / / Disallow: /admin, /api`. No bot-specific rules, so every AI crawler is allowed at app level. [verified]
- **Missing routes:** no RSS feed, no `llms.txt`, no author page, no editorial policy, **no privacy policy**, no hub or tag pages (tags are a client-side filter only). [verified]
- **Initial HTML:** the full article text is in the server HTML (SSG), so crawlers that don't execute JS still see it. [verified on a local production build; not on the live site]
- **Admin panel (`/admin`):** it commits `.mdx` files **directly to `main` through the GitHub Contents API** (a fine-grained PAT). This bypasses any review or CI. The pipeline must treat the repo as the source of truth and must never assume it is the only writer. [verified]
- **Security headers:** a strict CSP (`script-src 'self' 'unsafe-inline'`, `connect-src 'self'`, `img-src 'self' data: blob:`). **Any third-party analytics script would be blocked by the CSP** unless the policy is changed. [verified]
- **Conversion path:** the order form on `/reklaminis-video` builds a `mailto:` link. The `/kursai` waitlist form has a `// TODO: connect backend`, so it **submits nowhere**. There is **no analytics** of any kind. [verified] Consequence: "service inquiries attributed to articles" (a success metric in the spec) **cannot be measured today**, and some leads are probably lost. People without a configured mail client get nothing from a `mailto:` link. [inferred]
- **Business identity:** neither MB AIverslui, Mykolas Gustas nor any company details appear anywhere on the site. The footer says "© verslas.ai". [verified] For a site that sells services this is a trust (E-E-A-T) gap. It is also likely a legal gap: the e-Commerce Directive Art. 5 requires identifying the provider, and GDPR Art. 13 requires a privacy notice because personal data is collected by email and by the forms. [inferred; not legal advice]

### 1.3 Existing articles: voice, structure, problems

| File | Words | Status |
| --- | --- | --- |
| `ai-klientu-aptarnavimas.mdx` (2026-06-10) | 573 | **Placeholder.** It starts with `<Callout type="sample">Pavyzdinis straipsnis — pakeisk savo turiniu…`, yet its excerpt says "Realus scenarijus" about a fictional café. |
| `ai-produktu-aprasymai.mdx` (2026-06-14) | 522 | **Placeholder**, same sample callout. Fictional shop. |
| `ai-video-turai-brokeriams.mdx` (2026-07-09) | 726 | Real. Fictional broker "Ieva" presented as a narrative. Outcome numbers are stated as fact. |
| `reklaminis-video-kaina.mdx` (2026-09-09) | 1,060 | Real, and the strongest article (commercial intent, FAQ, table). Price ranges and "90 % smulkaus verslo poreikių" have **no source**. |

**Voice and structure** [verified]:
- Informal "tu" address.
- Concrete scenario → "Ką darysime" → "N žingsnis" H2s → prompt or code blocks with titles → "Prastai/Gerai" comparison tables → `Callout` tip/warning → "Rezultatas" plus one internal link to the previous article.
- Lithuanian „…“ quotes. Brand names are quoted („Instagram“). Headings are in sentence case.
- The newest article uses question-style H2s and a "D.U.K." section.

**Internal linking:** a single chain (each article links to the previous one, and the first links to nothing). [verified]

**Typography inconsistencies found** [verified]:
- Articles use the em dash "—" (9–26 per article), while some UI strings use the en dash "–".
- `lib/site.ts`, `lib/offer.ts` and `app/reklaminis-video/page.tsx` contain `„Instagram"` with a **straight closing quote**. That is a visible typo in live copy, including the meta description of the money page.

**Words to review for the glossary** [opinion; for the style guide, not verdicts]:
"brand'o", "SEO draugiškus", "konvertuoja", "promptai" vs "užklausos", "AI" vs "DI".

**The key conflict with the hard rules:** the house voice leans on invented people and invented outcomes presented as real ("Po savaitės … sutrumpėjo iki ~10 min"). Hard rule 2 forbids this, so **the pipeline cannot copy the existing voice as-is**. It will keep the structure (scenario → method → template → callout → result), but scenarios must read clearly as examples ("Pavyzdžiui, įsivaizduokime…"), and results must be sourced facts or clearly labelled expectations. The two real articles should be retrofitted the same way, through a normal PR.

### 1.4 Live site

**Not checked.** This cloud environment's network policy denies `verslas.ai` and `www.verslas.ai` (proxy `403` on CONNECT). WebFetch is blocked for the same host. [verified] So the following are **[unverified]**:

- whether the live site is the `verslas` repo's `main`;
- whether the sample articles are live;
- the live robots.txt and sitemap;
- Vercel Firewall settings (the "AI Bots" managed ruleset, Bot Protection, Attack Challenge Mode);
- whether AI crawlers get a 200.

A general web search for `site:verslas.ai` returned no results. That index is not Google, so this is only a weak hint that the domain is barely indexed. [inferred]

Caveat on bot tests: a WAF that verifies bots by IP range treats a spoofed `GPTBot` UA from a random IP differently from the real crawler. UA-spoofing tests can prove a UA-based block exists. They **cannot** prove real bots get through. The authoritative checks are the Vercel Firewall settings plus Vercel logs or observability showing real bot hits.

`docs/live-site-check.sh` runs every live check (status codes, AI-crawler UAs, head tags, robots, sitemap) from any machine with open internet.

---

## 2. Deviations from the spec (with reasons)

| # | Spec | Proposed | Reason |
| --- | --- | --- | --- |
| D1 | Astro content collection | Next.js MDX in `content/straipsniai/` | That is what the site is. |
| D2 | Pipeline in `pipeline/` inside the site repo | Pipeline in **its own repo, `postinimas`** (package at repo root). It opens PRs into `verslas`. | Full dependency isolation. The state branch lives outside the site repo, so it never triggers Vercel preview builds. PRs are opened with an App/PAT token, which also solves the "GITHUB_TOKEN PRs don't trigger workflows" problem. Costs, fact sheets and drafts stay out of the site repo's history. Trade-off: two repos and one cross-repo token. |
| D3 | Generate cover + 1200×630 OG image | **Reuse the site's existing `next/og` OG route.** Omit `cover` (the site already renders a generated fallback panel). Add an optional branded SVG cover later if wanted. | It already exists, uses the design tokens and contains no people. It is less code and less risk. |
| D4 | Phase order: 2 = ingest/score/brief, 3 = writing + gates | [opinion] **Swap:** build a thin vertical slice first (`article --topic` from the backlog → fact sheet → draft → all gates → shadow PR), then ingestion and scoring. | The riskiest assumption is that the models can produce publishable Lithuanian with zero fabricated facts at an acceptable cost and review time. Ingestion is commodity work. If the drafts don't reach 4/5, the whole plan changes. Your decision — see Q-C2. |
| D5 | Content mix ~60 % guides / ~40 % news | [opinion] **~75/25**, with most news going into the weekly roundup | Lithuanian search demand for "what vendor X announced" is small [inferred]. Evergreen, commercial-intent guides tied to the services are where search clicks and inquiries come from. Configurable; revisit with GSC data. |
| D6 | Target 3–5 articles/week | [opinion] **Start at 2–3/week** | A genuine review (claim table + Lithuanian read) takes ~20–40 min per article [guess]. Rubber-stamped approvals erode quality, and they also undermine the AI Act Art. 50(4) human-review exemption (§ 9). |

---

## 3. Architecture

```
                        ┌────────────────────── postinimas (pipeline repo) ──────────────────────┐
 cron 03:17+04:17 UTC ─►│ daily.yml ─► guard (Vilnius 06:xx? paused? caps? >5 open PRs?)         │
 (DST-safe, see 3.3)    │   1 ingest      RSS/Atom/APIs from config/sources.yml (no LLM)         │
                        │   2 normalise   canonical URL, dedupe, 7-day window (no LLM)           │
                        │   3 cluster     title similarity + Haiku merge for borderline pairs    │
                        │   4 score       Haiku prefilter → Sonnet 5 rubric scoring (top N)      │
                        │   5 decide      cannibalisation vs registry → action (or SKIP)         │
                        │   6 brief       Lithuanian daily brief → Telegram                      │
                        │   7 research    Sonnet 5 + web_search/web_fetch → fact-sheet.json      │
                        │   8 write       Opus 5.5 outline → draft (from fact sheet ONLY)        │
                        │   9 gates       LT editor (Opus 5.5) · deterministic LT checks ·       │
                        │                 fact-check (Sonnet 5, independent) · SEO · links ·     │
                        │                 MDX safety · site build            (≤2 revision loops) │
                        │  10 package     .mdx + frontmatter + links from 1–3 older articles     │
                        │  11 publish     PR into verslas (label shadow|approval) + Telegram     │
                        │  state branch:  registry, seen items, clusters, runs, cost ledger      │
                        └────────────────────────────────────┬───────────────────────────────────┘
                                                             │ GitHub App / fine-grained PAT
                        ┌────────────────────── verslas (site repo) ─────────────────────────────┐
                        │ PR ─► ci.yml (typecheck, lint, content checks, build) + Vercel preview  │
                        │ merge (you) ─► Vercel production ─► deployment_status=success          │
                        │   └► indexnow.yml pings changed URLs (key file in public/)              │
                        └─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Trust boundaries (prompt-injection design)

- **No model has side-effecting tools.** Models return JSON (structured outputs validated with zod) or text. Deterministic code does all git, PR, HTTP and Telegram work.
- Fetched web content only reaches the **research** step. The writer sees the **fact sheet**, not raw pages. That is a narrow, schema-validated channel.
- Code enforces the rules, not only prompts:
  - Every fact-sheet source URL must appear in this run's actual `web_fetch`/`web_search` results. Invented URLs are rejected.
  - Every outbound link in the article must be in the fact sheet and must resolve (HTTP 2xx/3xx) at packaging time.
  - Each claim needs a primary source or ≥2 independent registrable domains.
- **MDX safety check:** before the PR, the article is parsed with the MDX parser. Any `import`/`export`, JS expressions (`{…}`), raw HTML `<script>`/`<iframe>`, or any component other than `Callout` and `ProseImage` fails the gate. MDX is compiled at build time, so smuggled expressions are a real code-execution vector.
- The site build inside the pipeline runs in a **separate job with no secrets** in its environment.

### 3.2 Models and API usage

Model IDs live in `config/config.yml`. The defaults below were checked against the Anthropic pricing page on 2026-09-24 [verified]:

| Role | Model ID | Price (input / output per MTok) | Notes |
| --- | --- | --- | --- |
| Triage, cluster merge | `claude-haiku-4-5` | $1 / $5 | Cheap prefilter |
| Scoring, research, fact-check, brief, meta | `claude-sonnet-5` | $2 / $10 | `web_search_20260209` ($10 per 1,000 searches) and `web_fetch_20260209` (tokens only) |
| Outline, writing, Lithuanian copy edit | `claude-opus-5-5` | $4 / $20 (cache reads $0.20) | Thinking cannot be disabled (effort only; default `medium`). Forced `tool_choice` returns 400, so use structured outputs (`output_config.format`). |

- **Official TypeScript SDK** (`@anthropic-ai/sdk`) with `messages.parse()` and zod schemas. Streaming for long outputs. Typed error classes with retry and backoff.
- **Prompt caching** on the large static prefixes: style guide, glossary, banned phrases, schema docs and example articles.
- **Batch API** (−50 %) only for non-urgent weekly jobs (the refresh re-verification). It is not used for the daily path, because it has no latency guarantee.
- **Cost ledger:** every call records model, tokens (input, output, cache read/write), search count and USD cost.
  - Before each call, a worst-case cost (input estimate + `max_tokens` × output price) is checked against the per-run and monthly caps.
  - If the ledger can't be read or written, the run aborts (fail closed).
  - Second, independent stop: a spend limit set on the Anthropic Console workspace. You set it; it's a setting I don't touch.

### 3.3 Scheduling

- GitHub cron is UTC and often runs late, especially at `:00`. 06:00 Vilnius is 03:00 UTC in summer (EEST) and 04:00 UTC in winter (EET).
- The workflow fires at **03:17 and 04:17 UTC**. The guard computes Europe/Vilnius local time and proceeds only for the 06:xx firing, with a per-date idempotency key (so a re-run the same day is a no-op unless `--force`).
- `workflow_dispatch` is available for manual runs with inputs (mode, dry-run, topic).
- `concurrency: pipeline` prevents overlapping runs from racing on state.
- GitHub disables scheduled workflows in public repos after 60 days without repository activity. Daily state commits keep the repo active; a private repo avoids the issue anyway.

### 3.4 State (orphan branch `state` in `postinimas`)

JSON and JSONL files are diffable, easy to fix by hand, and need no infrastructure. SQLite is unnecessary at this volume [opinion].

```
state/
  seen-items.jsonl        # normalised feed items (url, title, source, tier, first_seen) — pruned >60 days
  clusters.jsonl          # cluster id, member items, score breakdown, action, reasoning
  decisions.jsonl         # one line per day: chosen action + why, or SKIP + why
  registry.json           # article registry: slug, title, primary keyword, cluster, type, sources,
                          #   published, updated, PR number, status — REBUILT from verslas main each run
                          #   (the admin panel can add articles the pipeline never saw)
  backlog.json            # merged from config/backlog.yml + GSC-derived ideas
  runs/<date>/…           # run log, fact sheets, drafts, gate reports, claim tables, brief
  costs.jsonl             # per-call cost ledger
  feeds-health.json       # last success / failure per feed
```

Heavy per-run artifacts are also uploaded as Actions artifacts (90-day retention) for debugging.

### 3.5 Config (human-editable, in `config/`)

| File | Contents |
| --- | --- |
| `config.yml` | mode (`shadow`/`approval`/`auto`), model IDs, effort levels, caps (per run / per article / monthly), cadence (max 1 article per day, weekly target), content mix, PR auto-close days (news 3, others 14), max open PRs (5), refresh age N, roundup toggle |
| `sources.yml` | feeds by tier (1 primary, 2 press, 3 signal-only, LT media = gap check only), URL, type (rss/atom/api), weight, enabled |
| `topics.yml` | clusters: name, description, hub page slug, CTA (label, href, one-line pitch), scoring weight |
| `style-guide.lt.md` | voice, structure, "example vs fact" rules, typography, the VLKK-based checklist |
| `glossary.yml` | preferred term → avoided variants (e.g. "dirbtinis intelektas (DI)", "užklausa (promptas)") plus a Hunspell whitelist of brand and tech terms |
| `banned-phrases.yml` | hype and calque phrases, each with a replacement suggestion |
| `backlog.yml` | your own topic and keyword ideas, with priority |
| `test-questions.yml` | 20 Lithuanian questions for the monthly manual AI-assistant citation check |
| `never-cover.yml` | topics excluded outright (your answer to Q10) |

### 3.6 CLI

```
npm run pipeline -- run [--dry-run] [--mode shadow|approval|auto] [--force]
npm run pipeline -- article --topic "…" [--dry-run]
npm run pipeline -- refresh [--dry-run]
npm run pipeline -- report [--week YYYY-Www]
npm run pipeline -- audit-site [--url https://verslas.ai]
```

- **Kill switch:** the repo variable `PIPELINE_PAUSED=true`. It is checked first in every job. A paused run exits 0 and sends one Telegram notice.
- `--dry-run` writes every artifact under `out/`. It opens no PR, sends no message, pings nothing, and writes nothing to state.

---

## 4. Daily run details (differences from the spec only)

- **Ingest.** Tier 3 sources (HN via the Algolia API, subreddits, newsletters, Product Hunt) can raise a cluster's score. They can never be a fact source: the fact-sheet validator rejects tier-3-only claims. Feeds failing 3 days in a row trigger an alert. No X/Twitter, YouTube or paywall scraping. robots.txt is checked before any non-feed fetch.
- **Scoring.** The weighted 0–5 rubric from the spec, with weights in `config.yml`. Penalties are explicit fields, so the reasoning is auditable. Output: a ranked top 10 with action and reasoning, stored in `clusters.jsonl` and summarised in the brief.
- **Cannibalisation.** Primary-keyword and title similarity against the registry (deterministic), then a Sonnet judgement for the top 3 overlaps. If the overlap is above the threshold, the action becomes `UPDATE_EXISTING`.
- **Research output.** `fact-sheet.json` exactly as in the spec: claims (each with its sources, `verified_by_primary` and confidence), unknowns, `lt_eu_context`, use cases, risks and questions. It also stores the fetch timestamp per source and a `conflicts[]` array.
  - Prices keep their original currency. EUR appears only with a stated rate and date.
  - Search intent comes from GSC queries when available. Otherwise it is model-proposed and labelled as a hypothesis. Google results are not scraped.
- **Writing.** Opus 5.5 at effort `high` for the draft, working from the fact sheet, style guide, glossary, 2 existing articles as structure references, the topic's CTA from `topics.yml`, and 3–5 internal link candidates from the registry.
- **Revision loop.** Gate failures are fed back as a structured list. At most 2 loops. If it still fails, the draft is discarded and logged, and you are notified with the failing gate and the reason.
- **Packaging.**
  - The `.mdx` file matches the current schema exactly, plus any new optional fields you approve (§ 6).
  - The PR adds contextual links **from** 1–3 older related articles. That touches approved articles, so it is done only inside the reviewable PR, never silently.
  - The PR body contains, in this order: the claim/source table, flagged risks, the list of Lithuanian edits and remaining uncertainties, scores, action type, cost, gate results, and the optional "your experience" question.

---

## 5. Quality gates

### 5.1 Lithuanian language

1. **Opus 5.5 "Lithuanian copy editor" pass**, with a separate system prompt and no access to the writer's reasoning. It uses a checklist based on VLKK guidance, including the *Didžiųjų kalbos klaidų sąrašas*: grammar, case agreement, word order, commas, calques and anglicisms, glossary terms, typography and banned phrases. It returns the corrected text plus a change list (a diff is generated in code).
2. **Deterministic checks (code):**
   - Hunspell `lt_LT`, plus the whitelist from `glossary.yml`.
   - Sentence-case headings (no English Title Case).
   - „…“ quotes only; a straight `"` inside Lithuanian text fails.
   - Decimal comma.
   - Date format "2026 m. rugsėjo 24 d.".
   - Relative time words forbidden ("vakar", "šią savaitę", "neseniai"…).
   - Currency as "20 €".
   - No English sentences: a heuristic language detector per sentence, with whitelisted code blocks and prompts.
   - One consistent dash style (Q-B7).
   - Banned phrases.
3. **Automated proofing tools — feasibility:**

   | Tool | Status |
   | --- | --- |
   | Hunspell `lt_LT` | Available (Debian `hunspell-lt`; npm `dictionary-lt` for use with `nspell` in Node). Spelling only, no grammar. [verified exists; I haven't checked its quality] |
   | LanguageTool | **Dropped Lithuanian.** Not usable. [verified via LanguageTool help and forum] |
   | Semantika.lt | Has a public web spelling/grammar corrector. **A usable public API is not confirmed.** Tested in the vertical-slice phase; if there's no API or its terms forbid automated use, it's documented as manual-only. [unverified] |
   | Tilde | [unverified] Checked in the same phase. |

   **Blunt expectation:** there is no reliable automated Lithuanian *grammar* checker. The LLM editor plus deterministic checks plus your read is the real gate. Comma errors will occasionally slip through. The PR lists every uncertainty the editor flagged; none are hidden.

### 5.2 Fact check (independent)

- A Sonnet 5 call (not the writer; a different model and prompt) extracts every factual claim from the final Lithuanian text and maps each one to fact-sheet claim IDs.
- Names, versions, numbers, dates, prices and availability statements are extracted as typed fields and compared deterministically where possible (e.g. a number in the text must equal the number in the fact sheet).
- Any unmapped or contradicted claim fails the gate. The claim table goes first in the PR.

### 5.3 SEO (deterministic + small model call)

- **Title tag** ≤ 60 characters **including** the site suffix; pixel width measured with a font-metrics table (≤ ~580 px).
- **Meta description** 140–160 characters.
- **Slug:** ASCII, no diacritics, short.
- One H1 and a clean H2/H3 hierarchy.
- The primary keyword appears in the title, H1, first 100 words, ≥1 H2 and the slug, and its density stays under the cap.
- 2–5 internal links, all resolving to existing slugs; outbound links follow the allowlist.
- Alt text is present and in Lithuanian.
- Length is within the band for the article type.
- Legal or regulatory topics include the "ne teisinė konsultacija" note.
- The FAQ block is present only if FAQ schema will be emitted.

### 5.4 Build

The site is checked out with the new article, and `npm ci && npm run typecheck && npm run build` runs, plus a content-check script. Nothing is proposed for merge on a red build (rule 7).

---

## 6. Site changes (Phase 1 — PRs into `verslas`, each needing your approval)

### 6.1 Schema extension proposal (backward-compatible; rule 9 requires your approval)

All new fields are **optional** with defaults, so the 4 existing articles build unchanged:

```ts
updated?: 'YYYY-MM-DD'                 // → dateModified, visible "Atnaujinta …", sitemap lastmod
type?: 'guide' | 'news' | 'comparison' | 'roundup'   // default 'guide'; 'news' → NewsArticle schema
author?: string                        // key into lib/authors.ts; default 'mykolas-gustas'
cluster?: string                       // key into topics → hub page + breadcrumbs
sources?: { title: string; url: string; publisher?: string; date?: string }[]
                                       // → rendered "Šaltiniai" section + JSON-LD citation
faq?: { q: string; a: string }[]       // → rendered visible FAQ + FAQPage JSON-LD
aiAssisted?: boolean                   // → short disclosure line (see § 9)
changeNote?: string                    // → visible "Kas pasikeitė" note on refreshes
```

`excerpt` keeps doubling as the meta description, with 140–160 characters enforced by the pipeline only. The `description` field is not added separately [opinion: fewer fields, fewer mistakes].

### 6.2 Site-level fixes

1. **Author:** `lib/authors.ts`, an `/apie/mykolas-gustas` author page, and a Person in JSON-LD (`url`, `sameAs`). Uses only details you provide.
2. **Publisher:** Organization "MB AIverslui" (brand verslas.ai) with a logo and company details. The Organization and WebSite schema go on the home page.
3. **Editorial policy page** "Kaip rengiame straipsnius": AI-assisted process, human review, sources, corrections, AI disclosure.
4. **Privacy policy** — needed as soon as analytics or forms exist. You supply the legal text or approve a draft; it's not legal advice.
5. **JSON-LD:**
   - `BlogPosting`/`NewsArticle` with headline, description and a raster image (the OG PNG instead of the SVG cover);
   - `datePublished`/`dateModified`, Person author and Organization publisher (with logo);
   - `inLanguage: "lt-LT"`, `mainEntityOfPage`, `about`/`mentions` (only when sameAs is accurate) and `citation`;
   - `BreadcrumbList`;
   - `FAQPage` only when a visible FAQ exists.
6. **Title template:** shorten the suffix or drop it on articles when the title is long. The pipeline then enforces ≤ 60 characters total.
7. **Hub page per cluster** (`/straipsniai/tema/[cluster]`) with real intro text. Hub copy goes through its own PR.
8. **RSS** (`/straipsniai/rss.xml`), **`/llms.txt`** (hubs and key articles), and a sitemap with `lastmod` from `updated ?? date`.
9. **robots.txt:** explicit allow groups for the search/answer bots and the training bots, according to your choice in Q-B11. The current `*` rule already allows all of them, so this is documentation plus explicitness.
10. **IndexNow:** key file in `public/`, and a `indexnow.yml` workflow triggered on a successful Vercel production `deployment_status`.
11. **Site CI:** `.github/workflows/ci.yml` runs typecheck, lint, build and content checks on PRs.
12. **Content cleanup** (your decision, Q-A4):
    - remove the two sample articles;
    - relabel the fictional scenarios in the two real ones as examples;
    - source or relabel the price ranges;
    - fix the straight quotes in `lib/site.ts`, `lib/offer.ts` and the video page meta.
13. **Measurement** (Q-A5): an analytics provider that works with the CSP, plus a real inquiry form endpoint so that inquiries attributed to articles become measurable.
14. **Audit report** (`reports/site-audit-<date>.md`) and a **metrics baseline** (indexed pages, GSC impressions and clicks, top-10 queries, AI referrals, inquiries). Anything unavailable is recorded as "not available yet", not left blank.

---

## 7. Cost estimate

All figures are **estimates** from current list prices (§ 3.2). They are to be replaced with measured numbers after the first real runs. Lithuanian tends to tokenise into more tokens per word than English [inferred], so token counts will be measured with `count_tokens` in the first build phase.

| Item | Assumption | Est. USD |
| --- | --- | --- |
| Daily ingest/triage/score/brief | Haiku ~50k in / 10k out; Sonnet ~45k in / 11k out | ~$0.30/day → **~$9/month** |
| Research (per article) | Sonnet 5, ~10 searches, ~300–400k input incl. fetched pages, ~10k out | ~$0.9–1.1 |
| Fact-sheet structuring | Sonnet 5, 40k in / 8k out | ~$0.16 |
| Outline + draft | Opus 5.5, 40k in / 20k out incl. thinking | ~$0.56 |
| Lithuanian copy edit | Opus 5.5, 30k in / 20k out | ~$0.52 |
| Fact-check + meta | Sonnet 5 | ~$0.2–0.3 |
| Revision loops | avg. 0.7 loop × ~$1 | ~$0.7 |
| **Per article** | | **~$3.2 (range $2–6)** |
| Weekly jobs | refresh re-verification (batched), roundup, report, GSC loop | **~$15/month** |
| **Monthly, 2–3 articles/week** | ~11 articles | **~$60** |
| **Monthly, 4–5 articles/week** | ~20 articles | **~$90** |
| **Pessimistic** | heavy research + max loops | **~$150** |
| Shadow period (2 weeks, 1 draft/day) | 14 drafts | **~$50** |

**Recommended caps** [opinion]: $150/month hard cap, $12 per run, $8 per article, with alerts at 50 % and 80 %, plus an Anthropic Console spend limit as an independent backstop.

**Non-API costs:**

| Service | Cost | Notes |
| --- | --- | --- |
| GitHub Actions | Free on public repos | On private repos the Free plan includes 2,000 min/month; the estimated use is ~600–900 min/month including site builds. [inferred] |
| Vercel | Pro, if needed | **Vercel's docs say Hobby is non-commercial only**, and this site sells a service. If the project is on Hobby, that is a terms problem independent of this pipeline. [verified docs; your plan unverified] |
| Telegram, GSC, Bing Webmaster Tools, IndexNow | Free | |

---

## 8. Risks (ranked)

1. **Review capacity.** An approval model only works if you actually review. With 3–5 PRs/week and ~20–40 min each, that is 1–3 hours/week [guess]. If that time doesn't exist, lower the cadence. Don't skim.
2. **Lithuanian quality ceiling.** No automated Lithuanian grammar checker exists (§ 5.1). Commas, case agreement and calques will occasionally slip through. The mitigations are the independent editor pass, the deterministic checks, your review, and tuning the glossary and banned phrases from your edits.
3. **Traffic expectations.** This is a new domain with 4 articles (2 of them placeholders), no visible index footprint, no backlinks and a small language market. [guess] Expect hundreds, not thousands, of monthly organic clicks by month 6. The pipeline does not create links or mentions, and those likely matter as much as volume (Lithuanian press, associations, partners). AI-assistant citations for Lithuanian queries are plausible, but their volume is unknown.
4. **Funnel mismatch.** Readers of AI news are mostly not buyers of a 99 € video. The README describes an AI-education, course and book funnel, while the live offer is video. The clusters and CTAs must lean toward the money topics, or the traffic won't convert. See Q-C1.
5. **Scaled-content risk.** Google's scaled-content-abuse policy targets volume without added value, including automated transformations. The mitigations are the §2 editorial principle enforced by gates (the LT/EU angle, steps and risks are required sections), the cannibalisation check, SKIP as a normal outcome, and a modest cadence.
6. **Fabrication leakage.** A model can present a plausible claim with a real-looking source. The mitigations are the fetched-URL provenance check, the independent fact-check, the claim table first in the PR, and zero-tolerance grading in shadow mode.
7. **Public repos.** Both `verslas` and `postinimas` are public. That exposes shadow drafts, fact sheets and costs, and it lets scrapers copy drafts before publication. Recommendation: make both private.
8. **Two writers to `main`.** The admin panel commits straight to `main`. The registry is rebuilt from `main` each run. A branch-protection proposal is in Q-A3.
9. **Legal / compliance.** No provider identification or privacy policy, and AI Act Art. 50(4) now applies (§ 9). Not legal advice; get a lawyer's view on the policy pages.
10. **Model and API drift.** Model IDs and prices change; `claude-opus-5-5` is newly launched. The IDs are config-only, and the ledger uses a price table in config with an effective date.
11. **Feed rot.** Vendor blogs change or drop RSS. Feed-health tracking and alerts cover this, and scraping is not a fallback.

## 9. EU AI Act Art. 50(4)

- Per current legal commentary, the Digital Omnibus postponed the high-risk obligations but **not** Art. 50. Art. 50 applies from **2 Aug 2026**. [verified via several law-firm summaries; I have not read the Commission's final July 2026 transparency guidelines myself.]
- Art. 50(4) requires deployers publishing AI-generated text *to inform the public on matters of public interest* to disclose it. The exception: the text underwent human review or editorial control, **and** a person holds editorial responsibility.
- In **approval** mode, with a documented review and you named as the responsible editor on the editorial policy page, the exemption should apply [opinion; not legal advice].
- [opinion] Add a short, honest line anyway on every pipeline article, e.g. "Parengta naudojant DI; faktus patikrino ir redagavo Mykolas Gustas". It costs nothing, matches Google's "Who/How/Why" guidance on disclosing automation, and removes any grey-zone argument.
- In **auto** mode, the visible AI-generation notice at the top is mandatory, as the spec says.
- Before enabling auto mode, read the Commission guidelines or get legal advice.

---

## 10. Phase plan

The build order below includes the proposed swap (D4). If you reject it, the spec's order is used unchanged.

| Phase | Scope | Done when |
| --- | --- | --- |
| **1. Site readiness** | § 6 changes as PRs into `verslas`; live audit (needs network access or your run of `docs/live-site-check.sh`); Vercel/GSC/Bing/IndexNow steps written for you; metrics baseline | Audit report all green, build passes, baseline recorded |
| **2. Vertical slice (shadow)** | Pipeline skeleton (config, state, ledger, caps, kill switch, CLI, tests); `article --topic` from the backlog → research → fact sheet → writer → all gates → shadow PR + Telegram | 5 shadow articles pass every gate; you rate them ≥ 4/5 with zero factual errors |
| **3. Ingest + scoring + brief** | Sources, dedupe, clustering, scoring, cannibalisation, daily brief; the daily `run` wired to the slice from phase 2 (still shadow) | 3 consecutive runs pick sensible topics (your judgement) |
| **4. Approval mode** | PR publishing, notifications, the `/patirtis` experience-answer flow, auto-close, backpressure, IndexNow on deploy | One article goes cron → PR → preview → merge → live → IndexNow ping |
| **5. Recurring jobs** | Weekly refresh, roundup, weekly report, GSC loop, alerts, monthly AI-citation checklist | Each job has run once for real, with its report delivered |

Engineering standards apply to every phase:

- tests for parsers, scoring, gates and frontmatter generation, with fixtures;
- `--dry-run` with zero side effects;
- idempotent runs, retries with backoff, timeouts and structured JSON logs;
- secrets only in GitHub Secrets, with least-privilege tokens;
- a README and a `CLAUDE.md`.

### The "experience" answer flow (Phase 4)

You comment on the PR with `/patirtis <your text>`. An hourly lightweight job in `postinimas` polls the open PRs. It uses no LLM unless it finds a comment. It then inserts your words into an attributed block, with language edits only, and commits the change to the PR. A Telegram reply flow can come later if you prefer it.

---

## 11. Open decisions

The questions are listed in the chat message in Lithuanian, each with my recommended default. Answer by number; defaults apply where you say "ok".

- **A: blocking decisions before Phase 1**
  - A1: pipeline repo location
  - A2: repo privacy
  - A3: branch protection vs. admin panel
  - A4: content cleanup
  - A5: analytics + inquiry form
  - A6: network access for the live audit
- **B: the spec's ten questions** (B1–B10), plus B11: training bots
- **C: strategy**
  - C1: primary business goal / CTA
  - C2: phase order
  - C3: cadence and mix

---

## 12. What I could not verify (carried into Phase 1)

- Live site content, headers, robots.txt, sitemap and Vercel Firewall behaviour (blocked by this environment's network policy).
- Which repo and branch Vercel deploys, and the Vercel plan.
- Whether PRs get Vercel preview URLs (no `vercel.json`; it depends on the dashboard Git settings).
- GSC and Bing verification status and current index coverage.
- Semantika.lt and Tilde API availability; the quality of the Hunspell `lt_LT` dictionary.
- Exact current AI-crawler UA strings. The names in the spec match OpenAI's and Anthropic's published crawler docs as summarised in search results. They will be re-checked against the vendor pages when robots.txt is written.
