import type { Config } from '../config.js';
import type { RegistryEntry } from '../site/registry.js';
import { slugify } from '../site/mdx.js';
import { gateResult, type GateResult } from './types.js';
import {
  containsKeyword,
  firstWords,
  headings,
  keywordStems,
  markdownImages,
  markdownLinks,
  prose,
  wordCount,
  words,
} from './text.js';

export interface SeoInput {
  title: string;
  seoTitle: string;
  slug: string;
  excerpt: string;
  body: string;
  faq: { q: string; a: string }[];
  type: 'guide' | 'news' | 'comparison';
  primaryKeyword: string;
  /** Topic cluster key; links are required only to articles of the same cluster. */
  cluster?: string;
}

/** Pages an article may link to besides other articles. */
const SITE_PAGES = new Set(['/', '/reklaminis-video', '/straipsniai', '/kursai', '/apie', '/kaip-rengiame-straipsnius']);

export function checkSeo(input: SeoInput, config: Config, registry: RegistryEntry[]): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { writing } = config;

  // Title tag and meta description
  if (input.seoTitle.length > writing.titleMax) {
    errors.push(`seoTitle ${input.seoTitle.length} simb. (daugiausia ${writing.titleMax}): „${input.seoTitle}“`);
  }
  if (input.title.length > 90) warnings.push(`H1 antraštė ilga (${input.title.length} simb.).`);
  const [minExcerpt, maxExcerpt] = writing.excerptLength;
  if (input.excerpt.length < minExcerpt || input.excerpt.length > maxExcerpt) {
    errors.push(`Aprašymas (excerpt) ${input.excerpt.length} simb. — reikia ${minExcerpt}–${maxExcerpt}.`);
  }

  // Slug
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) || input.slug.length > 60) {
    errors.push(`Netinkamas slug „${input.slug}“ (ASCII, brūkšneliai, ≤ 60 simb.).`);
  }
  if (registry.some((entry) => entry.slug === input.slug)) {
    errors.push(`Slug „${input.slug}“ jau naudojamas.`);
  }

  // Primary keyword placement (inflection-tolerant stems)
  const stems = keywordStems(input.primaryKeyword);
  if (stems.length > 0) {
    if (!containsKeyword(input.title, stems)) errors.push(`Pagrindinio raktažodžio „${input.primaryKeyword}“ nėra H1.`);
    if (!containsKeyword(input.seoTitle, stems)) warnings.push(`Pagrindinio raktažodžio nėra seoTitle.`);
    if (!containsKeyword(firstWords(input.body, 100), stems)) {
      warnings.push('Pagrindinio raktažodžio nėra pirmuose 100 žodžių.');
    }
    const h2s = headings(input.body).filter((heading) => heading.level === 2);
    if (!h2s.some((heading) => containsKeyword(heading.text, stems))) {
      warnings.push('Pagrindinio raktažodžio nėra nė viename H2.');
    }
    const asciiStems = stems.map((stem) => slugify(stem));
    if (!asciiStems.some((stem) => input.slug.includes(stem))) {
      errors.push(`Slug „${input.slug}“ neturi pagrindinio raktažodžio.`);
    }
    const bodyText = prose(input.body).toLowerCase();
    const hits = (bodyText.match(new RegExp(stems[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
    const density = hits / Math.max(1, words(bodyText).length / 100);
    if (density > 3) warnings.push(`Raktažodis kartojasi per dažnai (${density.toFixed(1)} / 100 žodžių).`);
  }

  // Heading hierarchy
  const all = headings(input.body);
  if (all.some((heading) => heading.level === 1)) errors.push('Tekste yra H1 (#) — H1 yra antraštė iš frontmatter.');
  const firstH2 = all.findIndex((heading) => heading.level === 2);
  if (all.some((heading, index) => heading.level === 3 && (firstH2 === -1 || index < firstH2))) {
    errors.push('H3 prieš pirmą H2.');
  }
  if (all.some((heading) => heading.level >= 4)) warnings.push('Naudojamos H4+ antraštės.');

  // Internal links
  const internal = markdownLinks(input.body)
    .map((link) => link.url.split(/[?#]/)[0] ?? '')
    .filter((url) => url.startsWith('/'));
  const known = new Set(registry.map((entry) => `/straipsniai/${entry.slug}`));
  for (const url of internal) {
    if (url.startsWith('/straipsniai/') && url !== '/straipsniai' && !known.has(url)) {
      errors.push(`Vidinė nuoroda į neegzistuojantį straipsnį: ${url}`);
    } else if (!url.startsWith('/straipsniai/') && !SITE_PAGES.has(url)) {
      errors.push(`Vidinė nuoroda į nežinomą puslapį: ${url}`);
    }
  }
  const articleLinks = new Set(internal.filter((url) => known.has(url)));
  // Only same-cluster articles make a link mandatory: with a small site, forcing a
  // link from an EU AI Act article to a video price guide makes the article worse.
  const related = registry.filter((entry) => input.cluster !== undefined && entry.cluster === input.cluster);
  const required = Math.min(writing.internalLinks.min, related.length);
  if (articleLinks.size < required) {
    errors.push(
      `Per mažai nuorodų į kitus straipsnius (${articleLinks.size}, reikia ≥ ${required}); tos pačios temos: ${related.map((entry) => `/straipsniai/${entry.slug}`).join(', ')}.`,
    );
  } else if (articleLinks.size === 0 && registry.length > 0) {
    warnings.push('Nėra nuorodų į kitus straipsnius — pridėk, jei kuris nors tikrai susijęs.');
  }
  if (new Set(internal).size > writing.internalLinks.max) {
    warnings.push(`Daug vidinių nuorodų (${new Set(internal).size}).`);
  }

  // Length by type
  const [min, max] = writing.lengthWords[input.type];
  const count = wordCount(input.body);
  if (count < min * 0.9 || count > max * 1.15) {
    errors.push(`Ilgis ${count} žodž. — tipui „${input.type}“ reikia ${min}–${max}.`);
  } else if (count < min || count > max) {
    warnings.push(`Ilgis ${count} žodž. šiek tiek už ${min}–${max} ribų.`);
  }

  // FAQ and images
  if (input.faq.length < writing.faq.min || input.faq.length > writing.faq.max) {
    errors.push(`DUK klausimų: ${input.faq.length} (reikia ${writing.faq.min}–${writing.faq.max}).`);
  }
  for (const image of markdownImages(input.body)) {
    if (!image.alt.trim()) errors.push(`Paveikslėlis be alt teksto: ${image.url}`);
  }

  return gateResult('seo', errors, warnings);
}
