import { describe, expect, it } from 'vitest';
import { buildArticleFile, slugify } from '../src/site/mdx.js';
import { readFrontmatter } from '../src/site/registry.js';

describe('article file', () => {
  it('slugifies Lithuanian text to ASCII', () => {
    expect(slugify('Kiek kainuoja reklaminis vaizdo įrašas? Ąžuolų čempionai')).toBe(
      'kiek-kainuoja-reklaminis-vaizdo-irasas-azuolu-cempionai',
    );
    expect(slugify('a '.repeat(80)).length).toBeLessThanOrEqual(60);
  });

  it('writes frontmatter the site schema accepts (strings stay strings)', () => {
    const file = buildArticleFile({
      title: 'Antraštė: „citata“',
      seoTitle: null,
      slug: 'antraste',
      date: '2026-09-24',
      excerpt: 'Aprašymas su dvitaškiu: taip.',
      tags: ['Video'],
      type: 'news',
      author: 'mykolas-gustas',
      cluster: 'ai-video-reklama',
      sources: [{ url: 'https://example.com/a', publisher: 'Ex', title: 'A', date: '2026-09-01', tier: 'primary' }],
      faq: [{ q: 'Ar taip?', a: 'Taip.' }],
      body: 'Tekstas.',
    });
    const { data, body } = readFrontmatter(file);
    expect(data).toMatchObject({
      title: 'Antraštė: „citata“',
      slug: 'antraste',
      date: '2026-09-24',
      draft: false,
      type: 'news',
      aiAssisted: true,
      sources: [{ title: 'A', url: 'https://example.com/a', publisher: 'Ex', date: '2026-09-01' }],
    });
    expect(typeof data.date).toBe('string');
    expect(data).not.toHaveProperty('seoTitle');
    expect(body.trim()).toBe('Tekstas.');
  });
});
