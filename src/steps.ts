import fs from 'node:fs';
import path from 'node:path';
import type { Cluster, PipelineConfig } from './config.js';
import type { LlmClient, ResearchResult } from './llm/client.js';
import {
  DraftSchema,
  EditorSchema,
  FactCheckSchema,
  FactSheetSchema,
  type Draft,
  type EditorOutput,
  type FactCheckOutput,
  type FactSheet,
} from './schemas.js';
import type { RegistryEntry } from './site/registry.js';

/**
 * One function per model step. Static instructions (prompt files, style
 * guide, glossary, banned phrases) form the system prompt so they are cached;
 * everything that varies per article goes in the user message.
 */

export interface ArticleRequest {
  topic: string;
  type: 'guide' | 'news' | 'comparison';
  cluster: Cluster;
  keyword?: string;
}

export interface StepContext {
  pc: PipelineConfig;
  llm: LlmClient;
  promptsDir: string;
  today: string;
  /** Per-article cost key. */
  article: string;
}

function prompt(ctx: StepContext, name: string): string {
  return fs.readFileSync(path.join(ctx.promptsDir, `${name}.md`), 'utf8');
}

function languageReference(ctx: StepContext): string {
  const { glossary, banned, styleGuide } = ctx.pc;
  const terms = glossary.terms
    .map((term) => `- ${term.preferred}${term.avoid.length ? ` (not: ${term.avoid.join(', ')})` : ''}${term.note ? ` — ${term.note}` : ''}`)
    .join('\n');
  const phrases = banned.map((item) => `- "${item.phrase}" → ${item.use}`).join('\n');
  return `\n\n# Style guide\n\n${styleGuide}\n\n# Glossary\n\n${terms}\n\n# Banned phrases\n\n${phrases}\n`;
}

function registryForPrompt(registry: RegistryEntry[]): string {
  return registry
    .map((entry) => `- /straipsniai/${entry.slug} — ${entry.title}: ${entry.excerpt}`)
    .join('\n');
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

export async function research(
  ctx: StepContext,
  request: ArticleRequest,
  registry: RegistryEntry[],
): Promise<ResearchResult> {
  const { config } = ctx.pc;
  return ctx.llm.research({
    step: 'research',
    model: config.models.research,
    effort: config.effort.research,
    system: prompt(ctx, 'research'),
    user: [
      `Today's date: ${ctx.today} (Europe/Vilnius).`,
      `Topic: ${request.topic}`,
      `Planned article type: ${request.type}`,
      `Topic cluster: ${request.cluster.name} — ${request.cluster.description}`,
      request.keyword ? `Keyword idea from the owner: ${request.keyword}` : '',
      `Existing verslas.ai articles (do not duplicate them; note overlaps):\n${registryForPrompt(registry) || '(none)'}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    maxTokens: 16_000,
    maxSearches: config.research.maxSearches,
    maxFetches: config.research.maxFetches,
    fetchMaxContentTokens: config.research.fetchMaxContentTokens,
    blockedDomains: config.research.blockedDomains,
    article: ctx.article,
  });
}

export async function buildFactSheet(
  ctx: StepContext,
  request: ArticleRequest,
  notes: ResearchResult,
): Promise<FactSheet> {
  const { config } = ctx.pc;
  return ctx.llm.structured({
    step: 'factsheet',
    model: config.models.factsheet,
    effort: config.effort.factsheet,
    system: prompt(ctx, 'factsheet'),
    user: [
      `Today's date: ${ctx.today}.`,
      `Topic: ${request.topic}`,
      `Article type: ${request.type}`,
      `URLs retrieved during research (the only URLs you may cite):\n${notes.seen.map((source) => `- ${source.url}`).join('\n')}`,
      `Research notes:\n\n${notes.notes}`,
    ].join('\n\n'),
    maxTokens: 16_000,
    schema: FactSheetSchema,
    article: ctx.article,
  });
}

export interface WriterInput {
  request: ArticleRequest;
  factSheet: FactSheet;
  registry: RegistryEntry[];
  previous?: { article: EditorOutput & { slug: string }; problems: string[] };
}

export async function write(ctx: StepContext, input: WriterInput): Promise<Draft> {
  const { config } = ctx.pc;
  const { request, factSheet } = input;
  const [minWords, maxWords] = config.writing.lengthWords[request.type];
  const brief = {
    today: ctx.today,
    topic: request.topic,
    articleType: request.type,
    lengthWords: `${minWords}–${maxWords} words in the body`,
    cluster: request.cluster.name,
    cta: request.cluster.cta ?? 'No CTA text for this topic.',
    primaryKeyword: request.keyword ?? factSheet.primaryKeyword,
    secondaryKeywords: factSheet.secondaryKeywords,
    readerQuestions: factSheet.questions,
    isLegalTopic: factSheet.isLegalTopic || request.cluster.legal,
    existingArticles: input.registry.map((entry) => ({
      url: `/straipsniai/${entry.slug}`,
      title: entry.title,
      excerpt: entry.excerpt,
      sameCluster: entry.cluster === request.cluster.key,
    })),
    houseFacts: config.houseFacts,
    factSheet: {
      claims: factSheet.claims,
      unknowns: factSheet.unknowns,
      conflicts: factSheet.conflicts,
      ltEuContext: factSheet.ltEuContext,
      useCases: factSheet.useCases,
      risks: factSheet.risks,
    },
  };

  const parts = [`Write the article from this brief.\n\n${json(brief)}`];
  if (input.previous) {
    parts.push(
      `This is a revision. Your previous version (after language editing) failed quality checks.\n\nPrevious version:\n${json(input.previous.article)}\n\nFix every problem below. Keep everything that was fine. Do not introduce new facts.\n\nProblems:\n${input.previous.problems.map((problem) => `- ${problem}`).join('\n')}`,
    );
  }

  return ctx.llm.structured({
    step: input.previous ? 'revise' : 'write',
    model: config.models.writer,
    effort: config.effort.writer,
    system: prompt(ctx, 'writer') + languageReference(ctx),
    user: parts.join('\n\n'),
    maxTokens: 32_000,
    schema: DraftSchema,
    article: ctx.article,
  });
}

export async function edit(ctx: StepContext, draft: Draft): Promise<EditorOutput> {
  const { config } = ctx.pc;
  return ctx.llm.structured({
    step: 'edit',
    model: config.models.editor,
    effort: config.effort.editor,
    system: prompt(ctx, 'editor') + languageReference(ctx),
    user: `Edit this article.\n\n${json({
      title: draft.title,
      seoTitle: draft.seoTitle,
      seoTitleAlternatives: draft.seoTitleAlternatives,
      excerpt: draft.excerpt,
      excerptAlternatives: draft.excerptAlternatives,
      bodyMdx: draft.bodyMdx,
      faq: draft.faq,
    })}`,
    maxTokens: 32_000,
    schema: EditorSchema,
    article: ctx.article,
  });
}

export async function factCheck(
  ctx: StepContext,
  article: { title: string; excerpt: string; bodyMdx: string; faq: { q: string; a: string }[] },
  factSheet: FactSheet,
): Promise<FactCheckOutput> {
  const { config } = ctx.pc;
  return ctx.llm.structured({
    step: 'factcheck',
    model: config.models.factcheck,
    effort: config.effort.factcheck,
    system: prompt(ctx, 'factcheck'),
    user: `Fact sheet:\n${json(factSheet.claims)}\n\nHouse facts (id "HOUSE"):\n${json(config.houseFacts)}\n\nArticle:\n${json(article)}`,
    maxTokens: 16_000,
    schema: FactCheckSchema,
    article: ctx.article,
  });
}
