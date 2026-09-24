import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { z } from 'zod';

/**
 * Human-editable configuration in config/*.yml, validated at startup so a bad
 * value stops the run before any API call is made.
 */

const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
const Range = z.tuple([z.number().int().nonnegative(), z.number().int().positive()]);

const ModelPrice = z.object({
  input: z.number().positive(),
  output: z.number().positive(),
  cacheWrite: z.number().positive(),
  cacheRead: z.number().positive(),
});

export const ConfigSchema = z.object({
  mode: z.enum(['shadow', 'approval', 'auto']),
  timezone: z.string(),
  site: z.object({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    baseBranch: z.string(),
    url: z.string().url(),
    contentDir: z.string(),
    defaultAuthor: z.string(),
    titleSuffix: z.string(),
  }),
  models: z.object({
    triage: z.string(),
    research: z.string(),
    factsheet: z.string(),
    factcheck: z.string(),
    writer: z.string(),
    editor: z.string(),
  }),
  effort: z.object({
    research: Effort,
    factsheet: Effort,
    factcheck: Effort,
    writer: Effort,
    editor: Effort,
  }),
  pricing: z.object({
    effectiveDate: z.string(),
    webSearchPer1000: z.number().nonnegative(),
    models: z.record(z.string(), ModelPrice),
  }),
  caps: z.object({
    perRunUsd: z.number().positive(),
    perArticleUsd: z.number().positive(),
    monthlyUsd: z.number().positive(),
    alertAtFractions: z.array(z.number().gt(0).lt(1)),
  }),
  cadence: z.object({
    maxArticlesPerDay: z.number().int().nonnegative(),
    targetPerWeek: z.number().int().nonnegative(),
    mix: z.object({ guides: z.number(), news: z.number() }),
    maxOpenPrs: z.number().int().positive(),
    prAutoCloseDays: z.object({ news: z.number().int(), other: z.number().int() }),
  }),
  research: z.object({
    maxSearches: z.number().int().positive(),
    maxFetches: z.number().int().positive(),
    fetchMaxContentTokens: z.number().int().positive(),
    worstCaseUsd: z.number().positive(),
    blockedDomains: z.array(z.string()),
  }),
  writing: z.object({
    revisionLoops: z.number().int().min(0).max(5),
    lengthWords: z.object({
      news: Range,
      guide: Range,
      comparison: Range,
      roundup: Range,
    }),
    internalLinks: z.object({ min: z.number().int(), max: z.number().int() }),
    faq: z.object({ min: z.number().int(), max: z.number().int() }),
    titleMax: z.number().int().positive(),
    excerptLength: Range,
  }),
  language: z.object({ dash: z.string() }),
  houseFacts: z.array(z.string()).default([]),
  evaluation: z.object({ maxUsd: z.number().positive() }).default({ maxUsd: 45 }),
});

export type Config = z.infer<typeof ConfigSchema>;

const ClusterSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string(),
  weight: z.number(),
  legal: z.boolean().default(false),
  cta: z.object({ href: z.string().startsWith('/'), hint: z.string() }).nullable(),
});
export type Cluster = z.infer<typeof ClusterSchema>;

const TopicsSchema = z.object({ clusters: z.array(ClusterSchema).min(1) });

const GlossarySchema = z.object({
  terms: z.array(
    z.object({
      preferred: z.string(),
      avoid: z.array(z.string()).default([]),
      note: z.string().optional(),
    }).strict(),
  ),
  spelling: z.object({
    stems: z.array(z.string()).default([]),
    words: z.array(z.string()).default([]),
  }),
});
export type Glossary = z.infer<typeof GlossarySchema>;

const BannedSchema = z.object({
  // strict(): an unquoted comma in a YAML flow map ("{ phrase: a, b, use: c }")
  // silently turns "b" into a key; fail loudly instead.
  phrases: z.array(z.object({ phrase: z.string(), use: z.string() }).strict()),
});
export type BannedPhrase = z.infer<typeof BannedSchema>['phrases'][number];

const BacklogSchema = z.object({
  items: z.array(
    z.object({
      topic: z.string(),
      type: z.enum(['guide', 'news', 'comparison']),
      cluster: z.string(),
      keyword: z.string().optional(),
      priority: z.number().int().default(5),
    }),
  ),
});
export type BacklogItem = z.infer<typeof BacklogSchema>['items'][number];

const NeverCoverSchema = z.object({ topics: z.array(z.string()) });

export interface PipelineConfig {
  config: Config;
  clusters: Cluster[];
  glossary: Glossary;
  banned: BannedPhrase[];
  backlog: BacklogItem[];
  /** Fixed topic set for quality evaluation (config/eval-topics.yml). */
  evalTopics: BacklogItem[];
  neverCover: string[];
  styleGuide: string;
}

function readYaml(file: string): unknown {
  return load(fs.readFileSync(file, 'utf8'));
}

function parse<T>(schema: z.ZodType<T>, file: string): T {
  const result = schema.safeParse(readYaml(file));
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid config in ${file}:\n${issues}`);
  }
  return result.data;
}

export function loadPipelineConfig(configDir: string): PipelineConfig {
  const file = (name: string) => path.join(configDir, name);
  const config = parse(ConfigSchema, file('config.yml'));
  const topics = parse(TopicsSchema, file('topics.yml'));

  for (const model of Object.values(config.models)) {
    if (!config.pricing.models[model]) {
      throw new Error(`No price configured for model "${model}" in config.yml → pricing.models`);
    }
  }

  return {
    config,
    clusters: topics.clusters,
    glossary: parse(GlossarySchema, file('glossary.yml')),
    banned: parse(BannedSchema, file('banned-phrases.yml')).phrases,
    backlog: parse(BacklogSchema, file('backlog.yml')).items,
    evalTopics: fs.existsSync(file('eval-topics.yml')) ? parse(BacklogSchema, file('eval-topics.yml')).items : [],
    neverCover: parse(NeverCoverSchema, file('never-cover.yml')).topics,
    styleGuide: fs.readFileSync(file('style-guide.lt.md'), 'utf8'),
  };
}
