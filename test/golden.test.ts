import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { unsupportedNumbers } from '../src/gates/factcheck.js';
import { checkLithuanian } from '../src/gates/lithuanian.js';
import { checkOutboundLinks } from '../src/gates/provenance.js';
import { checkSeo } from '../src/gates/seo.js';
import { checkStructure } from '../src/gates/structure.js';
import { wordCount } from '../src/gates/text.js';
import type { FactSheet } from '../src/schemas.js';
import { loadRegistry } from '../src/site/registry.js';
import { config, fixtures, pc } from './helpers.js';

/**
 * Golden articles: hand-checked, realistic articles in the pipeline's output
 * format. Every deterministic gate must pass them with zero errors — a gate
 * change that fails a good article is a false positive (it would cost a
 * revision loop or a whole run in the real pipeline). Real Hunspell is used
 * when installed (CI installs lt_LT and en_US).
 */

interface GoldenMeta {
  title: string;
  seoTitle: string;
  slug: string;
  excerpt: string;
  type: 'guide' | 'news' | 'comparison';
  cluster: string;
  keyword: string;
  legal: boolean;
  sourceUrls: string[];
  faq: { q: string; a: string }[];
}

const goldenDir = path.join(fixtures, 'golden');
const registry = loadRegistry(path.join(fixtures, 'site'), config.site.contentDir);

describe.each(fs.readdirSync(goldenDir))('golden article %s', (name) => {
  const dir = path.join(goldenDir, name);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'article.json'), 'utf8')) as GoldenMeta;
  const body = fs.readFileSync(path.join(dir, 'body.mdx'), 'utf8');
  const factSheet = JSON.parse(fs.readFileSync(path.join(dir, 'factsheet.json'), 'utf8')) as FactSheet;
  const readerText = [meta.title, meta.excerpt, body, ...meta.faq.flatMap((item) => [item.q, item.a])].join('\n\n');

  it('is a realistic length for its type', () => {
    const [min, max] = config.writing.lengthWords[meta.type];
    expect(wordCount(body)).toBeGreaterThanOrEqual(min);
    expect(wordCount(body)).toBeLessThanOrEqual(max);
  });

  it('passes the Lithuanian gate', () => {
    const result = checkLithuanian(
      { title: meta.title, seoTitle: meta.seoTitle, excerpt: meta.excerpt, body, faq: meta.faq },
      { glossary: pc.glossary, banned: pc.banned, dash: config.language.dash },
    );
    expect(result.errors).toEqual([]);
  });

  it('passes the SEO gate', () => {
    const result = checkSeo(
      { ...meta, body, primaryKeyword: meta.keyword },
      config,
      registry,
    );
    expect(result.errors).toEqual([]);
  });

  it('passes the structure gate', () => {
    expect(checkStructure({ body, isLegal: meta.legal }).errors).toEqual([]);
  });

  it('links only to fact-sheet sources', () => {
    expect(checkOutboundLinks(body, meta.sourceUrls, factSheet).errors).toEqual([]);
  });

  it('has a source for every number with a unit', () => {
    expect(unsupportedNumbers(readerText, factSheet, config.houseFacts)).toEqual([]);
  });
});
