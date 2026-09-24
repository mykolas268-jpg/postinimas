import { describe, expect, it } from 'vitest';
import { unsupportedNumbers } from '../src/gates/factcheck.js';
import { checkLithuanian } from '../src/gates/lithuanian.js';
import { checkOutboundLinks } from '../src/gates/provenance.js';
import { checkSeo } from '../src/gates/seo.js';
import { checkStructure } from '../src/gates/structure.js';
import type { FactSheet } from '../src/schemas.js';
import { config, pc } from './helpers.js';

/**
 * Gate regexes run on model output. Each of these inputs used to take 5–28 s
 * (quadratic backtracking); they must stay far below a second.
 */
const factSheet = { claims: [{ id: 'C1', claim: 'Pro costs 30 USD', value: null, sources: [{ url: 'https://a.lt' }] }] } as unknown as FactSheet;
const pathological: Record<string, string> = {
  'digits and spaces without a unit': `Tekstas ${'1 '.repeat(30_000)}pabaiga.`,
  'unclosed link brackets': `Tekstas ${'['.repeat(60_000)} pabaiga.`,
  'unclosed link targets': `Tekstas ${'[a]('.repeat(20_000)} pabaiga.`,
  'unclosed quotation marks': '„'.repeat(60_000),
};

describe('gate performance on pathological input', () => {
  it.each(Object.entries(pathological))('%s', (_name, body) => {
    const started = performance.now();
    checkLithuanian(
      { title: 'A', seoTitle: 'A', excerpt: 'A', body, faq: [] },
      { glossary: pc.glossary, banned: pc.banned, dash: '—', spellcheck: () => [], english: () => new Set() },
    );
    checkSeo({ title: 'A', seoTitle: 'A', slug: 'a', excerpt: 'a', body, faq: [], type: 'guide', primaryKeyword: 'video reklama' }, config, []);
    checkStructure({ body, isLegal: false });
    unsupportedNumbers(body, factSheet);
    expect(performance.now() - started).toBeLessThan(3_000);
    // The allowlist parses with the site's own MDX parser (micromark), which is
    // itself slower on thousands of unclosed "[a](" (~4 s at 80 KB; the site's
    // build pays the same). Output ceilings bound the size, so this stays finite.
    const parsed = performance.now();
    checkOutboundLinks(body, [], factSheet);
    expect(performance.now() - parsed).toBeLessThan(15_000);
  }, 30_000);

  it('reads separate numbers separately ("20 30 %" is not 2030)', () => {
    expect(unsupportedNumbers('Nuolaida siekia 20 30 % klientų.', factSheet)).toEqual([]);
    const only2030 = { claims: [{ id: 'C1', claim: 'In 2030', value: null, sources: [] }] } as unknown as FactSheet;
    expect(unsupportedNumbers('Nuolaida siekia 20 30 % klientų.', only2030)).toHaveLength(1);
  });
});
