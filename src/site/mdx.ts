import { dump } from 'js-yaml';
import type { Source } from '../schemas.js';

/**
 * Builds the article file exactly as the site's frontmatter schema expects
 * (lib/posts.ts in mykolas268-jpg/verslas). Field order mirrors the admin
 * panel so diffs stay readable.
 */

export interface ArticleFile {
  title: string;
  seoTitle: string | null;
  slug: string;
  date: string;
  excerpt: string;
  tags: string[];
  type: 'guide' | 'news' | 'comparison';
  author: string;
  cluster: string | null;
  sources: Source[];
  faq: { q: string; a: string }[];
  body: string;
}

export function buildArticleFile(article: ArticleFile): string {
  const frontmatter: Record<string, unknown> = {
    title: article.title,
    ...(article.seoTitle ? { seoTitle: article.seoTitle } : {}),
    slug: article.slug,
    date: article.date,
    excerpt: article.excerpt,
    tags: article.tags,
    draft: false,
    type: article.type,
    author: article.author,
    ...(article.cluster ? { cluster: article.cluster } : {}),
    aiAssisted: true,
    sources: article.sources.map((source) => ({
      title: source.title,
      url: source.url,
      publisher: source.publisher,
      ...(source.date && /^\d{4}-\d{2}-\d{2}$/.test(source.date) ? { date: source.date } : {}),
    })),
    faq: article.faq,
  };
  // Double-quoted strings keep dates and "yes"-like values as strings.
  const yaml = dump(frontmatter, { lineWidth: -1, noRefs: true, quoteStyle: 'double', forceQuotes: true });
  return `---\n${yaml}---\n\n${article.body.trim()}\n`;
}

const LT_TO_ASCII: Record<string, string> = {
  ą: 'a', č: 'c', ę: 'e', ė: 'e', į: 'i', š: 's', ų: 'u', ū: 'u', ž: 'z',
};

/** ASCII kebab-case slug from Lithuanian text (same rule as the site). */
export function slugify(text: string, maxLength = 60): string {
  const ascii = text
    .toLowerCase()
    .replace(/[ąčęėįšųūž]/g, (char) => LT_TO_ASCII[char] ?? char)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii.length <= maxLength) return ascii;
  return ascii.slice(0, maxLength).replace(/-[^-]*$/, '');
}
