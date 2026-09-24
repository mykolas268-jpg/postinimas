import fs from 'node:fs';
import path from 'node:path';
import type { PipelineConfig } from './config.js';
import type { CostLedger } from './costs.js';
import { checkFactCheck } from './gates/factcheck.js';
import { checkLinksResolve, type Fetcher } from './gates/links.js';
import { checkLithuanian, type SpellChecker } from './gates/lithuanian.js';
import {
  checkOutboundLinks,
  checkProvenance,
  factSheetUrls,
  normalizeUrl,
  sanitizeFactSheet,
} from './gates/provenance.js';
import { checkSeo } from './gates/seo.js';
import { checkStructure } from './gates/structure.js';
import { chooseFitting, keywordStems, markdownLinks, wordCount } from './gates/text.js';
import type { GateResult } from './gates/types.js';
import type { LlmClient } from './llm/client.js';
import { log } from './log.js';
import { buildPrBody } from './report.js';
import type { EditorOutput, FactCheckOutput, FactSheet, Source } from './schemas.js';
import { buildArticleFile, slugify } from './site/mdx.js';
import { loadRegistry, mostSimilar } from './site/registry.js';
import { buildFactSheet, edit, factCheck, research, write, type ArticleRequest, type StepContext } from './steps.js';

export interface ArticleRunOptions {
  pc: PipelineConfig;
  llm: LlmClient;
  ledger: CostLedger;
  siteDir: string;
  outDir: string;
  promptsDir: string;
  today: string;
  mode: 'shadow' | 'approval' | 'auto';
  checkLinks: boolean;
  spellcheck?: SpellChecker;
  fetcher?: Fetcher;
}

export interface ArticleOutcome {
  status: 'ready' | 'failed' | 'aborted';
  reason?: string;
  slug?: string;
  title?: string;
  articleFile?: string;
  prBodyFile?: string;
  costUsd: number;
}

function writeJson(dir: string, name: string, value: unknown): void {
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}

/** The site uses `seoTitle` only when "title + suffix" would be too long. */
function needsSeoTitle(title: string, suffix: string, max: number): boolean {
  return `${title}${suffix}`.length > max;
}

export async function runArticle(request: ArticleRequest, options: ArticleRunOptions): Promise<ArticleOutcome> {
  const { pc, llm, ledger, outDir } = options;
  const { config } = pc;
  fs.mkdirSync(outDir, { recursive: true });
  const articleKey = slugify(request.keyword ?? request.topic);
  const ctx: StepContext = { pc, llm, promptsDir: options.promptsDir, today: options.today, article: articleKey };
  const cost = () => ledger.articleTotal(articleKey);

  const banned = pc.neverCover.find((topic) => request.topic.toLowerCase().includes(topic.toLowerCase()));
  if (banned) return { status: 'aborted', reason: `Topic matches never-cover entry "${banned}"`, costUsd: 0 };

  const registry = loadRegistry(options.siteDir, config.site.contentDir);
  const similarMatch = mostSimilar(registry, `${request.topic} ${request.keyword ?? ''}`);
  const similar = similarMatch
    ? { slug: similarMatch.entry.slug, title: similarMatch.entry.title, score: similarMatch.score }
    : null;
  log.info('article_start', { topic: request.topic, type: request.type, cluster: request.cluster.key, similar });

  // Research and fact sheet -------------------------------------------------
  const notes = await research(ctx, request, registry);
  fs.writeFileSync(path.join(outDir, 'research.md'), notes.notes);
  writeJson(outDir, 'seen-sources.json', notes.seen);

  const rawFactSheet = await buildFactSheet(ctx, request, notes);
  writeJson(outDir, 'fact-sheet.raw.json', rawFactSheet);
  const sanitized = sanitizeFactSheet(rawFactSheet, notes.seen);
  const factSheet: FactSheet = sanitized.factSheet;
  writeJson(outDir, 'fact-sheet.json', factSheet);
  const provenance = checkProvenance(sanitized);
  if (!provenance.passed) {
    writeJson(outDir, 'gates.json', [provenance]);
    return { status: 'aborted', reason: provenance.errors.join('; '), costUsd: cost() };
  }

  const isLegal = factSheet.isLegalTopic || request.cluster.legal;
  const primaryKeyword = request.keyword ?? factSheet.primaryKeyword;

  // Write → edit → gates, with revision loops -------------------------------
  let previous: { article: EditorOutput & { slug: string }; problems: string[] } | undefined;
  let final: { edited: EditorOutput; slug: string; tags: string[]; sources: Source[]; experienceQuestion: string } | null = null;
  let gates: GateResult[] = [provenance];
  let factCheckResult: FactCheckOutput | null = null;
  let attempts = 0;

  for (let attempt = 0; attempt <= config.writing.revisionLoops; attempt += 1) {
    attempts = attempt + 1;
    const draft = await write(ctx, { request, factSheet, registry, ...(previous ? { previous } : {}) });
    const editorOutput = await edit(ctx, draft);
    // Models count characters badly: pick the variant that fits the limits.
    const stems = keywordStems(primaryKeyword);
    const [minExcerpt, maxExcerpt] = config.writing.excerptLength;
    const edited: EditorOutput = {
      ...editorOutput,
      excerpt: chooseFitting([editorOutput.excerpt, ...editorOutput.excerptAlternatives], minExcerpt, maxExcerpt, stems),
      seoTitle: chooseFitting([editorOutput.seoTitle, ...editorOutput.seoTitleAlternatives], 20, config.writing.titleMax, stems),
    };
    const slug = slugify(draft.slug || draft.title);
    fs.writeFileSync(path.join(outDir, `attempt-${attempts}.draft.mdx`), draft.bodyMdx);
    fs.writeFileSync(path.join(outDir, `attempt-${attempts}.edited.mdx`), edited.bodyMdx);

    const allowed = factSheetUrls(factSheet);
    const sourceUrls = [...new Set(draft.sourceUrls.map(normalizeUrl))].filter((url) => allowed.has(url));
    const byUrl = new Map(factSheet.claims.flatMap((claim) => claim.sources).map((source) => [normalizeUrl(source.url), source]));
    const sources = sourceUrls.map((url) => byUrl.get(url)!).filter(Boolean);

    gates = [
      provenance,
      checkLithuanian(
        { title: edited.title, seoTitle: edited.seoTitle, excerpt: edited.excerpt, body: edited.bodyMdx, faq: edited.faq },
        { glossary: pc.glossary, banned: pc.banned, dash: config.language.dash, ...(options.spellcheck ? { spellcheck: options.spellcheck } : {}) },
      ),
      checkSeo(
        { title: edited.title, seoTitle: edited.seoTitle, slug, excerpt: edited.excerpt, body: edited.bodyMdx, faq: edited.faq, type: request.type, primaryKeyword },
        config,
        registry,
      ),
      checkStructure({ body: edited.bodyMdx, isLegal }),
      checkOutboundLinks(edited.bodyMdx, draft.sourceUrls, factSheet),
    ];

    // The fact-check costs money; run it only when the cheap gates pass.
    factCheckResult = null;
    if (gates.every((gate) => gate.passed)) {
      factCheckResult = await factCheck(ctx, { title: edited.title, excerpt: edited.excerpt, bodyMdx: edited.bodyMdx, faq: edited.faq }, factSheet);
      gates.push(checkFactCheck(factCheckResult, factSheet, edited.bodyMdx, config.houseFacts));
    }
    if (options.checkLinks && gates.every((gate) => gate.passed)) {
      const external = [
        ...sources.map((source) => source.url),
        ...markdownLinks(edited.bodyMdx).map((link) => link.url).filter((url) => /^https?:/i.test(url)),
      ];
      gates.push(await checkLinksResolve(external, options.fetcher));
    }

    writeJson(outDir, `attempt-${attempts}.gates.json`, gates);
    log.info('attempt_done', { attempt: attempts, passed: gates.every((gate) => gate.passed), cost: cost() });

    final = { edited, slug, tags: draft.tags, sources, experienceQuestion: draft.experienceQuestion };
    if (gates.every((gate) => gate.passed)) break;

    previous = {
      article: { ...edited, slug },
      problems: gates.flatMap((gate) => gate.errors.map((error) => `[${gate.gate}] ${error}`)),
    };
  }

  // Package ---------------------------------------------------------------
  const passed = gates.every((gate) => gate.passed);
  const { edited, slug, tags, sources, experienceQuestion } = final!;
  const file = buildArticleFile({
    title: edited.title,
    seoTitle: needsSeoTitle(edited.title, config.site.titleSuffix, config.writing.titleMax) ? edited.seoTitle : null,
    slug,
    date: options.today,
    excerpt: edited.excerpt,
    tags,
    type: request.type,
    author: config.site.defaultAuthor,
    cluster: request.cluster.key,
    sources,
    faq: edited.faq,
    body: edited.bodyMdx,
  });
  const articleFile = path.join(outDir, `${slug}.mdx`);
  fs.writeFileSync(articleFile, file);
  writeJson(outDir, 'gates.json', gates);
  if (factCheckResult) writeJson(outDir, 'factcheck.json', factCheckResult);
  writeJson(outDir, 'editor.json', { changes: edited.changes, uncertainties: edited.uncertainties });
  writeJson(outDir, 'costs.json', ledger.runEntries);

  const prBody = buildPrBody({
    mode: options.mode,
    status: passed ? 'ready' : 'failed',
    title: edited.title,
    slug,
    type: request.type,
    cluster: request.cluster.name,
    primaryKeyword,
    words: wordCount(edited.bodyMdx),
    attempts,
    factSheet,
    factCheck: factCheckResult,
    editor: edited,
    gates,
    costs: ledger.runEntries,
    experienceQuestion,
    similar,
    demotedClaims: sanitized.demotedClaims.length,
  });
  const prBodyFile = path.join(outDir, 'pr-body.md');
  fs.writeFileSync(prBodyFile, prBody);
  writeJson(outDir, 'summary.json', {
    status: passed ? 'ready' : 'failed',
    slug,
    title: edited.title,
    type: request.type,
    cluster: request.cluster.key,
    attempts,
    costUsd: Number(cost().toFixed(4)),
    articleFile: path.basename(articleFile),
  });

  return {
    status: passed ? 'ready' : 'failed',
    ...(passed ? {} : { reason: 'Quality gates still failing after the maximum number of revisions' }),
    slug,
    title: edited.title,
    articleFile,
    prBodyFile,
    costUsd: cost(),
  };
}
