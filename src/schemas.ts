import { z } from 'zod';

/**
 * Schemas for model outputs (structured outputs). They stay simple on the
 * wire — required fields, nullable instead of optional, no length limits —
 * and business rules are enforced afterwards by the gates.
 */

export const SourceSchema = z.object({
  url: z.string().describe('Exact URL of a page returned by web_search or web_fetch in this session'),
  publisher: z.string().describe('Organisation that published the page, e.g. "OpenAI", "The Verge"'),
  title: z.string(),
  date: z.string().nullable().describe('Publication date YYYY-MM-DD if shown, else null'),
  tier: z.enum(['primary', 'secondary']).describe('primary = the company/institution itself (announcement, docs, pricing, help center, official register); secondary = press or third parties'),
});
export type Source = z.infer<typeof SourceSchema>;

export const ClaimSchema = z.object({
  id: z.string().describe('C1, C2, …'),
  claim: z.string().describe('One precise, checkable statement in English'),
  kind: z.enum(['price', 'availability', 'date', 'version', 'number', 'feature', 'requirement', 'regulation', 'other']),
  value: z.string().nullable().describe('The exact value (price with currency, date, version, number) when the claim has one'),
  sources: z.array(SourceSchema),
  verifiedByPrimary: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const FactSheetSchema = z.object({
  topic: z.string(),
  articleType: z.enum(['guide', 'news', 'comparison']),
  summary: z.string().describe('3–5 sentence English summary of what the sources establish'),
  primaryKeyword: z.string().describe('Lithuanian search phrase a business owner would type'),
  secondaryKeywords: z.array(z.string()),
  questions: z.array(z.string()).describe('5–8 natural Lithuanian questions readers ask'),
  claims: z.array(ClaimSchema),
  unknowns: z.array(z.string()).describe('Things that could not be verified'),
  conflicts: z.array(z.object({ description: z.string(), urls: z.array(z.string()) })),
  ltEuContext: z.object({
    euAvailability: z.string(),
    ltAvailability: z.string(),
    lithuanianLanguageSupport: z.string(),
    pricing: z.string(),
    gdprNotes: z.string(),
    aiActNotes: z.string(),
    alternatives: z.array(z.string()),
  }).describe('Each field cites claim ids like (C3); write "unknown" when not established'),
  useCases: z.array(z.string()).describe('Concrete use cases for Lithuanian SMBs (ideas, not facts)'),
  risks: z.array(z.string()),
  isLegalTopic: z.boolean(),
});
export type FactSheet = z.infer<typeof FactSheetSchema>;

const FaqSchema = z.object({ q: z.string(), a: z.string() });

export const DraftSchema = z.object({
  title: z.string().describe('Lithuanian H1 with the primary keyword, sentence case'),
  seoTitle: z.string().describe('<title>, at most 60 characters'),
  slug: z.string().describe('Short ASCII kebab-case slug from Lithuanian words, no diacritics'),
  excerpt: z.string().describe('Meta description, 140–160 characters, with a reason to click'),
  tags: z.array(z.string()).describe('2–4 Lithuanian tags'),
  bodyMdx: z.string().describe('Article body in MDX, without the H1, FAQ or sources'),
  faq: z.array(FaqSchema).describe('3–5 real reader questions with direct answers'),
  sourceUrls: z.array(z.string()).describe('Fact-sheet URLs the article relies on, most important first'),
  claimIdsUsed: z.array(z.string()),
  experienceQuestion: z.string().describe('One Lithuanian question asking the owner about his own experience with the topic'),
});
export type Draft = z.infer<typeof DraftSchema>;

export const EditorSchema = z.object({
  title: z.string(),
  seoTitle: z.string(),
  excerpt: z.string(),
  bodyMdx: z.string(),
  faq: z.array(FaqSchema),
  changes: z.array(z.object({ before: z.string(), after: z.string(), reason: z.string() })),
  uncertainties: z.array(z.string()).describe('Language points the editor is not sure about (Lithuanian)'),
});
export type EditorOutput = z.infer<typeof EditorSchema>;

export const FactCheckSchema = z.object({
  claims: z.array(
    z.object({
      text: z.string().describe('The statement as written in the article (Lithuanian, verbatim or near-verbatim)'),
      kind: z.enum(['price', 'availability', 'date', 'version', 'number', 'name', 'feature', 'regulation', 'other']),
      claimIds: z.array(z.string()),
      status: z.enum(['supported', 'unsupported', 'contradicted', 'example', 'opinion']),
      note: z.string(),
    }),
  ),
});
export type FactCheckOutput = z.infer<typeof FactCheckSchema>;
