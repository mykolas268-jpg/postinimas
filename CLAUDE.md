# Maintenance notes for the verslas.ai content pipeline

Read `docs/PLAN.md` first (decisions log in § 0, phase plan in § 10).

## Ground rules (from the owner's spec — do not relax without asking)

- Code, config and docs in English; everything readers see, and every
  notification to the owner, in Lithuanian.
- No fabricated facts, numbers, quotes, case studies or experience. Every
  claim traces to the fact sheet (primary source, or ≥ 2 independent ones).
- Fetched web content is untrusted data. Models never get side-effecting tools.
- Never merge PRs; never change DNS, CDN/WAF, analytics or hosting settings —
  give the owner exact steps instead.
- Site frontmatter schema (`lib/posts.ts` in mykolas268-jpg/verslas) may only
  be extended backward-compatibly and with the owner's approval.
- Cost caps fail closed.

## Layout

- `src/cli.ts` — commands; `src/article.ts` — the vertical slice orchestrator.
- `src/steps.ts` — one function per model step; prompts live in `prompts/`.
- `src/gates/*` — deterministic quality gates (pure functions, unit-tested).
- `src/llm/anthropic.ts` — the only file that talks to the API (streaming,
  structured outputs via `zodOutputFormat`, web_search/web_fetch
  `_20260209`, `pause_turn` handling). `src/llm/fixture.ts` replays
  `test/fixtures/<scenario>/<step>[.<n>].json`.
- `src/costs.ts` — pricing, ledger, caps. Prices live in `config/config.yml`.
- `.github/workflows/article.yml` — generate (API key) → verify (no secrets)
  → publish (site token). Keep secrets out of the verify job.

## API notes (verified 2026-09-24)

- `claude-opus-5-5`: thinking cannot be disabled (control with effort);
  forced `tool_choice` returns 400 → use structured outputs.
- `claude-haiku-4-5` rejects `effort` (see `supportsEffort`).
- Web search is billed per search ($10 / 1,000); web fetch only by tokens.
- Re-check model IDs and prices at platform.claude.com before changing them.

## Changing things safely

- New gate or rule → add a unit test in `test/gates.test.ts`; keep the
  fixture article passing (`test/article.test.ts`).
- Prompt changes → run the fixture dry run, then one real shadow run, and
  compare the PR against the previous shadow PRs.
- Anything the site must accept → run the site's
  `node scripts/check-content.mjs --strict <file>` and `npm run build`.
