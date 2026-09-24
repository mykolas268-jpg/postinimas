import { describe, expect, it } from 'vitest';
import { checkFactCheck, numbersIn, unsupportedNumbers } from '../src/gates/factcheck.js';
import { checkLithuanian, hunspellLt, type SpellChecker } from '../src/gates/lithuanian.js';
import { checkSeo } from '../src/gates/seo.js';
import { checkStructure } from '../src/gates/structure.js';
import { keywordStems } from '../src/gates/text.js';
import type { FactSheet } from '../src/schemas.js';
import { config, pc } from './helpers.js';

const noSpell: SpellChecker = () => [];
const lt = (body: string, extra: Partial<Parameters<typeof checkLithuanian>[0]> = {}) =>
  checkLithuanian(
    { title: 'Antraštė', seoTitle: 'Antraštė', excerpt: 'Aprašymas.', body, faq: [], ...extra },
    { glossary: pc.glossary, banned: pc.banned, dash: '—', spellcheck: noSpell },
  );

describe('Lithuanian gate', () => {
  it('accepts clean text', () => {
    expect(lt('Kaina — 20 € per mėnesį, o nuolaida siekia 10 %. Terminas: 2026 m. rugsėjo 24 d.').errors).toEqual([]);
  });

  it.each([
    ['Tekstas "su kabutėmis".', /Tiesios kabutės/],
    ['Tai “angliškos” kabutės.', /Angliškos kabutės/],
    ['Kaina 2.5 val. darbo.', /Dešimtainis/],
    ['Atnaujinta 2026-09-24.', /Data/],
    ['Tai paskelbta vakar.', /Santykinis laikas/],
    ['Kaina €20 per mėnesį.', /Valiuta/],
    ['Nuolaida 10% visiems.', /Procentai/],
    ['Jis pilnai sutiko.', /Vengtina frazė „pilnai“/],
    ['Mums reikia daugiau kontento.', /Terminas „kontento“/],
    ['This is the best tool for your business and it can help you.', /angliškų sakinį/],
  ])('flags %s', (text, pattern) => {
    expect(lt(text).errors.join('\n')).toMatch(pattern);
  });

  it('ignores quoted text and code', () => {
    expect(lt('Frazė „pilnai sutinku“ yra klaida.\n\n```text\nThis is the prompt for the model.\n```').errors).toEqual([]);
  });

  it('flags English Title Case headings', () => {
    expect(lt('Tekstas.', { title: 'Kaip Sukurti Reklaminį Video' }).errors.join()).toMatch(/Title Case/);
  });

  it('classifies likely typos as errors and unknown names as warnings', () => {
    const spell: SpellChecker = () => [
      { word: 'užsakimas', suggestions: ['užkasimas', 'užsakymas'] },
      { word: 'ExampleVideo', suggestions: ['Videofilmas'] },
      { word: 'klipų', suggestions: ['kilpų'] },
    ];
    const result = checkLithuanian(
      { title: 'A', seoTitle: 'A', excerpt: 'A', body: 'x', faq: [] },
      { glossary: pc.glossary, banned: pc.banned, dash: '—', spellcheck: spell },
    );
    expect(result.errors).toEqual(['Galima rašybos klaida: „užsakimas“ → „užsakymas“?']);
    expect(result.warnings.join()).toMatch(/ExampleVideo/);
    expect(result.warnings.join()).not.toMatch(/klipų/); // whitelisted stem
  });

  it('real hunspell (lt_LT) catches a typo when installed', () => {
    const result = hunspellLt('Kaina ir užsakimas.');
    if (result === null) return; // hunspell not installed on this machine
    expect(result.map((item) => item.word)).toContain('užsakimas');
  });
});

describe('structure gate', () => {
  const good = `Atsakymas į klausimą pirmuose sakiniuose.

<Callout type="info" title="Trumpai">

- vienas
- du
- trys

</Callout>

## Kam tai aktualu, o kam ne

Tekstas.

## Ką daryti dabar

Tekstas.

## Kokie ribojimai ir rizikos?

Tekstas.`;

  it('passes a well-formed body', () => {
    expect(checkStructure({ body: good, isLegal: false }).errors).toEqual([]);
  });

  it('requires the legal note for legal topics', () => {
    expect(checkStructure({ body: good, isLegal: true }).errors.join()).toMatch(/Ne teisinė konsultacija/);
  });

  it.each([
    ['import x from "y"\n\n' + good, /import\/export/],
    [good + '\n\nTekstas {process.env.SECRET}.', /riestiniai/],
    [good + '\n\n<script>alert(1)</script>', /<script>/],
    [good.replace('type="info" title="Trumpai"', 'type="info" title="Santrauka"'), /Trumpai/],
    [good.replace('## Ką daryti dabar', '## Kas toliau'), /Ką daryti dabar/],
    ['## Antraštė pradžioje\n\n' + good, /atsakymu/],
  ])('rejects unsafe or incomplete bodies (%#)', (body, pattern) => {
    expect(checkStructure({ body, isLegal: false }).errors.join('\n')).toMatch(pattern);
  });
});

describe('SEO gate', () => {
  const body = `${'Žodis '.repeat(520)}\n\n## Kaip veikia AI video įrankis?\n\n[kainos](/straipsniai/reklaminis-video-kaina)`;
  const base = {
    title: 'AI video įrankis: kaina ir galimybės',
    seoTitle: 'AI video įrankis: kaina ir galimybės',
    slug: 'ai-video-irankis',
    excerpt: 'x'.repeat(150),
    body,
    faq: [{ q: 'a', a: 'b' }, { q: 'c', a: 'd' }, { q: 'e', a: 'f' }],
    type: 'news' as const,
    primaryKeyword: 'AI video įrankis',
  };
  const registry = [{ slug: 'reklaminis-video-kaina', title: 'Kaina', excerpt: '', tags: [], date: '2026-09-09', updated: null, type: 'guide', cluster: null, draft: false, file: '' }];

  it('passes a compliant article', () => {
    expect(checkSeo(base, config, registry).errors).toEqual([]);
  });

  it.each([
    [{ seoTitle: 'x'.repeat(61) }, /seoTitle/],
    [{ excerpt: 'per trumpas' }, /excerpt/],
    [{ slug: 'Netinkamas_Slug' }, /slug/i],
    [{ slug: 'reklaminis-video-kaina' }, /jau naudojamas/],
    [{ title: 'Kita antraštė be rakto' }, /H1/],
    [{ body: body.replace('/straipsniai/reklaminis-video-kaina', '/straipsniai/nera') }, /neegzistuojantį/],
    [{ body: '# H1\n\n' + body }, /H1/],
    [{ faq: [] }, /DUK/],
  ])('flags %o', (patch, pattern) => {
    expect(checkSeo({ ...base, ...patch }, config, registry).errors.join('\n')).toMatch(pattern);
  });

  it('builds inflection-tolerant keyword stems', () => {
    expect(keywordStems('reklaminio video kaina')).toEqual(['reklam', 'vide', 'kain']);
  });
});

describe('fact-check gate', () => {
  const factSheet = {
    claims: [{ id: 'C1', claim: 'Pro costs 20 USD per month', value: '20 USD', kind: 'price', sources: [], verifiedByPrimary: true, confidence: 'high' }],
  } as unknown as FactSheet;

  it('extracts numbers across formats', () => {
    expect([...numbersIn('1 200,50 € ir 20–30 sek.')]).toEqual(expect.arrayContaining(['120050', '20', '30']));
  });

  it('flags numbers missing from the fact sheet unless marked as examples', () => {
    expect(unsupportedNumbers('Kaina — 20 USD per mėnesį.', factSheet)).toEqual([]);
    expect(unsupportedNumbers('Kaina — 25 USD per mėnesį.', factSheet)).toHaveLength(1);
    expect(unsupportedNumbers('Pavyzdžiui, tarkime, sutaupytum 50 €.', factSheet)).toEqual([]);
    expect(unsupportedNumbers('Video kainuoja 99 €.', factSheet, config.houseFacts)).toEqual([]);
  });

  it('fails on unsupported, contradicted and unmarked examples', () => {
    const result = checkFactCheck(
      {
        claims: [
          { text: 'A', kind: 'price', claimIds: [], status: 'unsupported', note: 'n' },
          { text: 'B', kind: 'price', claimIds: ['C1'], status: 'contradicted', note: 'n' },
          { text: 'Kavinė sutaupo daug.', kind: 'other', claimIds: [], status: 'example', note: '' },
          { text: 'C', kind: 'price', claimIds: ['C9'], status: 'supported', note: '' },
        ],
      },
      factSheet,
      '',
    );
    expect(result.errors).toHaveLength(4);
  });
});
