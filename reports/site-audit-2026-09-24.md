# Site audit and metrics baseline — 2026-09-24

Source: `Live site audit` workflow runs
[#1](https://github.com/mykolas268-jpg/postinimas/actions/runs/35971637361) and
[#2](https://github.com/mykolas268-jpg/postinimas/actions/runs/35971769818)
(GitHub runner, read-only), plus a local production build of `mykolas268-jpg/verslas@b1d0e19`.

Fix status refers to [mykolas268-jpg/verslas#2](https://github.com/mykolas268-jpg/verslas/pull/2)
(open, not merged, so none of the fixes are live yet).

## Findings

| # | Check | Live result (before #2) | Status after #2 |
| --- | --- | --- | --- |
| 1 | Hosting | Vercel (`server: Vercel`, `x-vercel-id`). DNS nameservers `ns1/ns2.dns-parking.com` (Hostinger DNS [inferred from the NS names]). Apex `216.198.79.1`, `www` → `cname.vercel-dns.com`. | — |
| 2 | Serving origin | `https://verslas.ai` → **308** → `https://www.verslas.ai`; `http://` → 2 redirects → www. | — (fine as is) |
| 3 | Canonical host | Canonical tag points to `https://verslas.ai/...` (redirects) | **Fixed**: canonical = www |
| 4 | Env value | `NEXT_PUBLIC_SITE_URL` has a leading **tab**: sitemap `<loc>\thttps://verslas.ai/...`, JSON-LD `"url":"\thttps://verslas.ai"` | **Fixed in code** (trim + apex→www). Env value still wrong in Vercel → Vercel phase |
| 5 | Placeholder articles | `ai-klientu-aptarnavimas`, `ai-produktu-aprasymai` live (HTTP 200) | **Removed** (404) |
| 6 | Title tags | `Kiek kainuoja … Realios 2026 m. kainos · verslas.ai` (75 chars) | `Reklaminio video kaina verslui: 2026 m. gidas · verslas.ai` (58) |
| 7 | Meta description | 181 chars | 155 chars |
| 8 | Article text in initial HTML | yes | yes |
| 9 | AI crawler UAs (Googlebot, Bingbot, Applebot, OAI-SearchBot, ChatGPT-User, GPTBot, PerplexityBot, Perplexity-User, ClaudeBot, Claude-SearchBot, Claude-User, CCBot) | all **200** (no UA-based block). Caveat: a spoofed UA proves only that no UA rule blocks; IP-verified bot rules can't be tested this way. | Firewall settings → Vercel phase |
| 10 | robots.txt | `User-agent: *` allow, `/admin` `/api` disallowed | Explicit bot groups |
| 11 | sitemap.xml | apex URLs with tab; samples listed; no lastmod on static routes | www URLs, samples gone, `lastmod` from `updated ?? date` |
| 12 | JSON-LD | BlogPosting, author = Organization "verslas.ai komanda", `inLanguage: lt`, SVG image, no breadcrumbs | Person author, publisher logo (PNG), `lt-LT`, raster image, BreadcrumbList, citation/FAQ support; Organization + WebSite on home |
| 13 | RSS / llms.txt | 404 / 404 | `/straipsniai/rss.xml`, `/llms.txt` |
| 14 | Publisher identity, privacy policy, editorial policy | none | Added (company code/address still to be provided) |
| 15 | Inquiry path | `mailto:` only; waitlist form stored nothing but said "Ačiū!" | API (activates with Telegram env in Vercel phase), honest fallback, article attribution |
| 16 | Analytics | none | Deferred to Vercel phase (Web Analytics) |
| 17 | PR previews | Vercel creates deployments for PR branches (`deployment_status` events from `vercel[bot]` on #2) | — |
| 18 | CI | none | CI on every PR |

## Metrics baseline

| Metric | Baseline 2026-09-24 | Source / note |
| --- | --- | --- |
| Published articles | 2 real (+2 placeholders, removed in #2) | repo |
| Indexed articles | **not available yet** | needs Google Search Console access (question B8) |
| GSC impressions / clicks for /straipsniai | **not available yet** | GSC |
| Queries in top 10 | **not available yet** | GSC |
| AI-referral visits | **not measurable yet** | no analytics until the Vercel phase |
| Service inquiries attributed to articles | **0 measurable**; from #2 on, every inquiry names its source article (`?straipsnis=`) | forms |
| Weak external signal | a US web-search index returned no results for `site:verslas.ai` | not Google; low weight |

## Re-run

After #2 is merged and deployed: Actions → "Live site audit" → Run workflow, then
update this report (or add a new dated one).
