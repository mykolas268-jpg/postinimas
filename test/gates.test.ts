import { describe, expect, it } from 'vitest';
import { checkFactCheck, numbersIn, unsupportedNumbers } from '../src/gates/factcheck.js';
import { checkLithuanian, hunspellEn, hunspellLt, type SpellChecker } from '../src/gates/lithuanian.js';
import { checkSeo } from '../src/gates/seo.js';
import { checkStructure } from '../src/gates/structure.js';
import { keywordStems } from '../src/gates/text.js';
import type { FactSheet } from '../src/schemas.js';
import { config, pc } from './helpers.js';

const noSpell: SpellChecker = () => [];
const lt = (body: string, extra: Partial<Parameters<typeof checkLithuanian>[0]> = {}) =>
  checkLithuanian(
    { title: 'Antraštė', seoTitle: 'Antraštė', excerpt: 'Aprašymas.', body, faq: [], ...extra },
    { glossary: pc.glossary, banned: pc.banned, dash: '—', spellcheck: noSpell, english: () => new Set() },
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
    ['This is the best tool for your business and it can help you.', /anglišką sakinį/],
  ])('flags %s', (text, pattern) => {
    expect(lt(text).errors.join('\n')).toMatch(pattern);
  });

  // An unquoted comma in the YAML once turned "nesvarbu, ar esate" into a ban on "nesvarbu".
  it('bans the cliché, not the ordinary word', () => {
    expect(lt('Tai nesvarbu, kai kalbame apie kainą.').errors).toEqual([]);
    expect(lt('Nesvarbu, ar esate kavinė, ar parduotuvė.').errors.join()).toMatch(/nesvarbu, ar esate/);
  });

  // Mirrors the site's check:content --strict, which does not exempt quotations.
  it('flags relative time words and straight quotes even inside quotations', () => {
    expect(lt('Agentūros sako: „reikia rytoj“.').errors.join()).toMatch(/Santykinis laikas „rytoj“ citatoje/);
    expect(lt('Citata: „tai "geriausias" įrankis“.').errors.join()).toMatch(/Tiesios kabutės/);
  });

  it('ignores quoted text and code', () => {
    expect(lt('Frazė „pilnai sutinku“ yra klaida.\n\n```text\nThis is the prompt for the model.\n```').errors).toEqual([]);
  });

  it('flags English Title Case headings', () => {
    expect(lt('Tekstas.', { title: 'Kaip Sukurti Reklaminį Video' }).errors.join()).toMatch(/Title Case/);
  });

  // Comparison articles name plans in H3s; lowercasing them would be wrong.
  it('allows product-name headings but not Lithuanian Title Case', () => {
    const body = 'Tekstas.\n\n### Google Workspace Business Standard\n\nTekstas.\n\n### Kainos Ir Planai Verslui\n\nTekstas.';
    const spell: SpellChecker = () => ['Google', 'Workspace', 'Business', 'Standard'].map((word) => ({ word, suggestions: [] }));
    const run = (spellcheck: SpellChecker, english: (words: string[]) => Set<string> | null) =>
      checkLithuanian(
        { title: 'Antraštė', seoTitle: 'Antraštė', excerpt: 'Aprašymas.', body, faq: [] },
        { glossary: pc.glossary, banned: pc.banned, dash: '—', spellcheck, english },
      );
    const result = run(spell, (words) => new Set(words.filter((word) => word !== 'Kainos' && word !== 'Planai' && word !== 'Verslui')));
    expect(result.errors).toEqual(['Antraštė angliškai „Title Case“: „Kainos Ir Planai Verslui“ — rašyk sakinio stiliumi.']);
    expect(result.warnings.join()).toMatch(/Google Workspace Business Standard/);
    // Without the dictionaries both stay errors (fail closed).
    expect(run(() => null, () => null).errors.filter((error) => /Title Case/.test(error))).toHaveLength(2);
  });

  it('classifies likely typos as errors and unknown names as warnings', () => {
    const spell: SpellChecker = () => [
      { word: 'užsakimas', suggestions: ['užkasimas', 'užsakymas'] },
      { word: 'ExampleVideo', suggestions: ['Videofilmas'] },
      { word: 'klipų', suggestions: ['kilpų'] },
    ];
    const result = checkLithuanian(
      { title: 'A', seoTitle: 'A', excerpt: 'A', body: 'x', faq: [] },
      { glossary: pc.glossary, banned: pc.banned, dash: '—', spellcheck: spell, english: () => new Set() },
    );
    expect(result.errors).toEqual(['Galima rašybos klaida: „užsakimas“ → „užsakymas“?']);
    expect(result.warnings.join()).toMatch(/ExampleVideo/);
    expect(result.warnings.join()).not.toMatch(/klipų/); // whitelisted stem
  });

  // Found by running the gate on the site's own published articles: English
  // camera-move terms ("crane up", "pan right") and prompt examples were
  // reported as Lithuanian typos one letter away from a Lithuanian word.
  it('treats valid English words as terms, not Lithuanian typos', () => {
    const spell: SpellChecker = () => [
      { word: 'crane', suggestions: ['ciane'] },
      { word: 'užsakimas', suggestions: ['užsakymas'] },
    ];
    const run = (english: (words: string[]) => Set<string> | null) =>
      checkLithuanian(
        { title: 'A', seoTitle: 'A', excerpt: 'A', body: 'x', faq: [] },
        { glossary: pc.glossary, banned: pc.banned, dash: '—', spellcheck: spell, english },
      );
    const known = run((words) => new Set(words.filter((word) => word === 'crane')));
    expect(known.errors).toEqual(['Galima rašybos klaida: „užsakimas“ → „užsakymas“?']);
    expect(known.warnings.join()).toMatch(/Angliškas žodis „crane“/);
    // Without the en_US dictionary it fails closed.
    const missing = run(() => null);
    expect(missing.errors).toHaveLength(2);
    expect(missing.warnings.join()).toMatch(/en_US/);
  });

  it('real hunspell (en_US) knows English terms and not Lithuanian words when installed', () => {
    const known = hunspellEn(['crane', 'photo', 'užsakimas']);
    if (known === null) return; // en_US dictionary not installed on this machine
    expect([...known].sort()).toEqual(['crane', 'photo']);
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
    // MDX parse failures confirmed with the site's check:content --strict
    [good + '\n\nVienas skliaustas { be pabaigos.', /riestiniai/],
    [good + '\n\nKaina <15 žodžių.', /„<15/],
    [good + '\n\n| Planas | Kaina |\n| --- | --- |\n| Pro | <20 USD |', /„<20/],
    [good + '\n\nJei 5 <= 10.', /„<=/],
    [good + '\n\nRodyklė <- atgal.', /„<-/],
    [good + '\n\n<!-- komentaras -->', /„<!--/],
    [good + '\n\nEilutės pabaiga <', /„<“/],
  ])('rejects unsafe or incomplete bodies (%#)', (body, pattern) => {
    expect(checkStructure({ body, isLegal: false }).errors.join('\n')).toMatch(pattern);
  });

  it('accepts MDX-safe comparison signs, arrows and code', () => {
    const body = good + '\n\nKaina < 15 žodžių, jei a > b. Rodyklė -> pirmyn. Kode `<15` ir `{x}`.\n\n```text\n<15 {x}\n```';
    expect(checkStructure({ body, isLegal: false }).errors).toEqual([]);
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

  it('requires internal links only to articles of the same cluster', () => {
    const noLinks = { ...base, body: body.replace(/\[([^\]]*)\]\(\/straipsniai\/reklaminis-video-kaina\)/g, '$1') };
    expect(noLinks.body).not.toMatch(/\/straipsniai\//);
    const sameCluster = [{ ...registry[0]!, cluster: 'ai-video-reklama' }];
    expect(checkSeo({ ...noLinks, cluster: 'ai-video-reklama' }, config, sameCluster).errors.join()).toMatch(/Per mažai nuorodų.*reklaminis-video-kaina/);
    const other = checkSeo({ ...noLinks, cluster: 'di-reguliavimas' }, config, sameCluster);
    expect(other.errors.join()).not.toMatch(/Per mažai nuorodų/);
    expect(other.warnings.join()).toMatch(/Nėra nuorodų į kitus straipsnius/);
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

  it('matches amounts written with tūkst. / mln. against full numbers and back', () => {
    const sheet = (claim: string): FactSheet => ({ ...factSheet, claims: [{ ...factSheet.claims[0]!, claim, value: '' }] });
    expect(unsupportedNumbers('Parama — iki 50 tūkst. €.', sheet('Grants up to EUR 50,000.'))).toEqual([]);
    expect(unsupportedNumbers('Biudžetas — 1,5 mln. €.', sheet('Budget of EUR 1 500 000.'))).toEqual([]);
    expect(unsupportedNumbers('Biudžetas — 2 000 000 €.', sheet('Biudžetas 2 mln. Eur.'))).toEqual([]);
    expect(unsupportedNumbers('Kaina — 1 200,50 €.', sheet('Costs EUR 1,200.50.'))).toEqual([]);
    expect(unsupportedNumbers('Parama — iki 60 tūkst. €.', sheet('Grants up to EUR 50,000.'))).toHaveLength(1);
    expect(unsupportedNumbers('Kaina — 1 300,50 €.', sheet('Costs EUR 1,200.50.'))).toHaveLength(1);
  });

  // The checker may quote only the clause after the marker; the article sentence decides.
  it('judges example markers on the article sentence, not the checker quote', () => {
    const run = (body: string) =>
      checkFactCheck(
        { claims: [{ text: 'kavinė per savaitę sutaupytų kelias valandas', kind: 'other', claimIds: [], status: 'example', note: '' }] },
        factSheet,
        body,
      ).errors.filter((error) => /Pavyzdys/.test(error));
    expect(run('Pavyzdžiui, kavinė per savaitę sutaupytų kelias valandas.')).toEqual([]);
    expect(run('Kavinė per savaitę sutaupytų kelias valandas.')).toHaveLength(1);
    expect(run('Visai kitas tekstas be šio sakinio.')).toHaveLength(1);
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

describe('length-limited field chooser', () => {
  it('picks a variant inside the range, preferring one with the keyword', async () => {
    const { chooseFitting, containsKeyword, keywordStems } = await import('../src/gates/text.js');
    const stems = keywordStems('AI video reklama');
    expect(chooseFitting(['x'.repeat(170), 'AI video reklama ' + 'y'.repeat(130), 'z'.repeat(150)], 140, 160, stems)).toMatch(/^AI video reklama/);
    expect(chooseFitting(['x'.repeat(170), 'z'.repeat(150)], 140, 160, stems)).toBe('z'.repeat(150));
    expect(chooseFitting(['x'.repeat(175), 'y'.repeat(165)], 140, 160)).toBe('y'.repeat(165));
    // 3-word keyword: one word may be rephrased; 2-word keywords need both
    expect(containsKeyword('DI įrankių kainos verslui', keywordStems('DI įrankiai verslui kainos'))).toBe(true);
    expect(containsKeyword('Kainos verslui', keywordStems('DI įrankiai verslui kainos'))).toBe(true);
    expect(containsKeyword('Kainos', keywordStems('DI įrankiai verslui kainos'))).toBe(false);
    expect(containsKeyword('Video be reklamos', keywordStems('video reklama'))).toBe(true);
    expect(containsKeyword('Video be kainų', keywordStems('video reklama'))).toBe(false);
  });
});
