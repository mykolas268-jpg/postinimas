import { spawnSync } from 'node:child_process';
import type { BannedPhrase, Glossary } from '../config.js';
import { gateResult, type GateResult } from './types.js';
import { headings, prose, sentences, withoutQuotations, words } from './text.js';

/**
 * Deterministic Lithuanian checks. The Opus copy editor does the judgement
 * work; this gate catches what code can catch reliably (typography, dates,
 * banned phrases, leftover English) and runs Hunspell for spelling.
 */

export interface LithuanianInput {
  title: string;
  seoTitle: string;
  excerpt: string;
  body: string;
  faq: { q: string; a: string }[];
}

export interface LithuanianOptions {
  glossary: Glossary;
  banned: BannedPhrase[];
  dash: string;
  /** Injected for tests; defaults to the system `hunspell` binary. */
  spellcheck?: SpellChecker;
  /** Injected for tests; defaults to `hunspell -d en_US`. */
  english?: EnglishLexicon;
}

export interface Misspelling {
  word: string;
  suggestions: string[];
}

export type SpellChecker = (text: string) => Misspelling[] | null;

/** Runs `hunspell -a -d lt_LT`. Returns null when hunspell isn't installed. */
export const hunspellLt: SpellChecker = (text) => {
  const lines = text.split('\n').map((line) => `^${line}`); // ^ = treat line as text
  const run = spawnSync('hunspell', ['-a', '-d', 'lt_LT', '-i', 'utf-8'], {
    input: `${lines.join('\n')}\n`,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error || run.status !== 0) return null;
  const result: Misspelling[] = [];
  for (const line of run.stdout.split('\n')) {
    // "& word count offset: s1, s2" or "# word offset"
    const suggested = line.match(/^& (\S+) \d+ \d+: (.*)$/);
    if (suggested) {
      result.push({ word: suggested[1]!, suggestions: suggested[2]!.split(', ').filter(Boolean) });
      continue;
    }
    const none = line.match(/^# (\S+) \d+$/);
    if (none) result.push({ word: none[1]!, suggestions: [] });
  }
  return result;
};

/**
 * Returns the words the en_US dictionary knows, or null when it isn't
 * installed. Used so English terms (camera moves, prompt examples, UI labels)
 * aren't reported as Lithuanian typos one letter away from a Lithuanian word.
 */
export type EnglishLexicon = (words: string[]) => Set<string> | null;

export const hunspellEn: EnglishLexicon = (candidates) => {
  if (candidates.length === 0) return new Set();
  const run = spawnSync('hunspell', ['-l', '-d', 'en_US', '-i', 'utf-8'], {
    input: `${candidates.join('\n')}\n`,
    encoding: 'utf8',
  });
  if (run.error || run.status !== 0 || /Can't open/.test(run.stderr)) return null;
  const unknown = new Set(run.stdout.split('\n').filter(Boolean));
  return new Set(candidates.filter((word) => !unknown.has(word)));
};

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

const ENGLISH_STOP = new Set([
  'the', 'and', 'of', 'to', 'in', 'is', 'are', 'for', 'with', 'that', 'this', 'on', 'it', 'as',
  'by', 'be', 'you', 'your', 'can', 'will', 'from', 'or', 'an', 'at', 'not', 'have', 'has',
]);
const LT_LETTERS = /[ąčęėįšųūž]/i;
const RELATIVE_TIME = /(?<!\p{L})(vakar|šiandien|rytoj|šią savaitę|šios savaitės|praėjusią savaitę|šį mėnesį|neseniai|ką tik|šiuo metu naujausias)(?!\p{L})/iu;
const EN_MONTHS = /\b(January|February|March|April|June|July|August|September|October|November|December)\b/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseRegExp(phrase: string): RegExp {
  return new RegExp(`(?<!\\p{L})${escapeRegExp(phrase)}(?!\\p{L})`, 'iu');
}

export function checkLithuanian(input: LithuanianInput, options: LithuanianOptions): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const faqText = input.faq.map((item) => `${item.q}\n${item.a}`).join('\n\n');
  const allProse = [input.title, input.seoTitle, input.excerpt, prose(input.body), faqText].join('\n\n');
  const styleText = withoutQuotations(allProse);

  // The site's `check:content --strict` (verify job) reads the body with quotations
  // included, so these two rules must too, or a passing article fails in verify.
  const bodyWithQuotes = prose(input.body);

  // Typography -------------------------------------------------------------
  if (/"/.test(styleText) || /"/.test(bodyWithQuotes)) errors.push('Tiesios kabutės " — naudok „…“ (ir citatose).');
  if (/[”]/.test(allProse) || /(^|[\s(])“/m.test(allProse)) {
    errors.push('Angliškos kabutės “…” / ” — naudok lietuviškas „…“.');
  }
  const decimal = styleText.match(/\b\d+\.\d+\s?(%|€|EUR|USD|val\.|min\.?|sek\.?|proc\.|mln\.?|tūkst\.?)/);
  if (decimal) errors.push(`Dešimtainis taškas „${decimal[0]}“ — naudok kablelį (2,5 val.).`);
  const iso = styleText.match(/\b20\d\d-\d\d-\d\d\b/);
  if (iso) errors.push(`Data „${iso[0]}“ — rašyk „2026 m. rugsėjo 24 d.“.`);
  const month = styleText.match(EN_MONTHS);
  if (month) errors.push(`Angliškas mėnesio pavadinimas „${month[0]}“.`);
  const relative = styleText.match(RELATIVE_TIME);
  const quotedRelative = bodyWithQuotes.match(RELATIVE_TIME);
  if (relative) errors.push(`Santykinis laikas „${relative[0]}“ — nurodyk konkrečią datą.`);
  else if (quotedRelative) {
    errors.push(`Santykinis laikas „${quotedRelative[0]}“ citatoje — svetainės patikra jo neleidžia; perfrazuok arba rinkis kitą citatą.`);
  }
  const currency = styleText.match(/(€|\$|\bEUR|\bUSD)\s?\d/);
  if (currency) errors.push(`Valiuta prieš skaičių „${currency[0]}…“ — rašyk „20 €“, „20 USD“.`);
  const percent = styleText.match(/\d%/);
  if (percent) errors.push(`Procentai be tarpo „${percent[0]}“ — rašyk „80 %“.`);
  if (options.dash === '—' && / – /.test(styleText)) {
    warnings.push('Sakinio brūkšnys „ – “ — svetainėje naudojamas „ — “.');
  }

  // Spelling runs first: the heading check below reuses what Hunspell knows.
  const spellcheck = options.spellcheck ?? hunspellLt;
  const english = options.english ?? hunspellEn;
  const misspellings = spellcheck(allProse);
  const unknownToLt = misspellings === null ? null : new Set(misspellings.map((item) => item.word.toLowerCase()));

  // Headings: sentence case --------------------------------------------------
  const knownCapitalised = new Set(options.glossary.spelling.words.map((word) => word.toLowerCase()));
  for (const heading of [{ text: input.title }, ...headings(input.body)]) {
    const headingWords = words(withoutQuotations(heading.text)).slice(1);
    const capitalised = headingWords.filter(
      (word) =>
        /^\p{Lu}\p{Ll}/u.test(word) &&
        !knownCapitalised.has(word.toLowerCase()) &&
        !/^(Lietuv|Vilni|Kaun|Klaipėd|Europ|ES$)/.test(word),
    );
    if (headingWords.length >= 3 && capitalised.length === headingWords.length) {
      // "Kaip Sukurti Reklaminį Video" is Title Case; "Google Workspace Business
      // Standard" is a product name. Only Lithuanian words make it an error;
      // without the dictionaries it stays an error (fail closed).
      const englishWords = unknownToLt === null ? null : english(capitalised);
      const lithuanian = capitalised.some(
        (word) =>
          LT_LETTERS.test(word) ||
          unknownToLt === null ||
          englishWords === null ||
          (!unknownToLt.has(word.toLowerCase()) && !englishWords.has(word)),
      );
      if (lithuanian) errors.push(`Antraštė angliškai „Title Case“: „${heading.text}“ — rašyk sakinio stiliumi.`);
      else warnings.push(`Visi antraštės žodžiai iš didžiosios raidės: „${heading.text}“ — gerai, jei tai produkto pavadinimas.`);
    } else if (capitalised.length >= 2) {
      warnings.push(`Antraštėje daug didžiųjų raidžių: „${heading.text}“ — patikrink, ar tai tikriniai vardai.`);
    }
    if (/[!]$/.test(heading.text.trim())) errors.push(`Šauktukas antraštėje: „${heading.text}“.`);
  }

  // Banned phrases and glossary ------------------------------------------------
  for (const { phrase, use } of options.banned) {
    if (phraseRegExp(phrase).test(styleText)) errors.push(`Vengtina frazė „${phrase}“ → ${use}.`);
  }
  for (const term of options.glossary.terms) {
    for (const avoid of term.avoid) {
      if (phraseRegExp(avoid).test(styleText)) {
        errors.push(`Terminas „${avoid}“ → „${term.preferred}“.`);
      }
    }
  }

  // Leftover English sentences ----------------------------------------------
  for (const sentence of sentences(styleText)) {
    const tokens = words(sentence).map((word) => word.toLowerCase());
    if (tokens.length < 6 || LT_LETTERS.test(sentence)) continue;
    const englishStops = tokens.filter((token) => ENGLISH_STOP.has(token)).length;
    if (englishStops / tokens.length >= 0.25) {
      errors.push(
        `Panašu į anglišką sakinį: „${sentence.slice(0, 120)}“ — išversk; jei tai užklausos (prompt) pavyzdys, dėk jį į \`kodą\` arba kodo bloką.`,
      );
    }
  }

  // Spelling (Hunspell) -----------------------------------------------------
  let skipped: string | undefined;
  if (misspellings === null) {
    skipped = 'hunspell (lt_LT) neįdiegtas — rašyba netikrinta';
    warnings.push(skipped);
  } else {
    const stems = options.glossary.spelling.stems.map((stem) => stem.toLowerCase());
    const seen = new Set<string>();
    const typos: { word: string; closest: string }[] = [];
    const unknown: { word: string; closest: string | undefined }[] = [];
    for (const { word, suggestions } of misspellings) {
      const lower = word.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      if (knownCapitalised.has(lower)) continue;
      if (stems.some((stem) => lower.startsWith(stem))) continue;
      if (/\d/.test(word) || /^\p{Lu}{2,}$/u.test(word)) continue; // versions, acronyms
      const closest = [...suggestions].sort(
        (a, b) => levenshtein(lower, a.toLowerCase()) - levenshtein(lower, b.toLowerCase()),
      )[0];
      // Only lowercase words count as likely typos: capitalised unknown words
      // are usually names Hunspell doesn't know.
      const likelyTypo =
        closest !== undefined &&
        /^\p{Ll}/u.test(word) &&
        word.length >= 5 &&
        levenshtein(lower, closest.toLowerCase()) === 1;
      if (likelyTypo) typos.push({ word, closest });
      else unknown.push({ word, closest });
    }
    // One en_US lookup for every candidate. A valid English word is a term, an
    // example or part of a product name ("Business", "Team"), not a Lithuanian typo.
    const englishWords = english([...typos, ...unknown].map((item) => item.word));
    // Unknown words that are English are left out of the report: in comparisons
    // they are dozens of plan names and would bury the words worth checking.
    for (const { word, closest } of unknown) {
      if (!englishWords?.has(word)) warnings.push(`Hunspell nežino žodžio „${word}“${closest ? ` (siūlo „${closest}“)` : ''}.`);
    }
    // Without the en_US dictionary every typo candidate stays an error (fail closed).
    const englishTypos = englishWords;
    if (englishTypos === null && typos.length > 0) warnings.push('hunspell (en_US) neįdiegtas — angliški terminai laikomi klaidomis');
    for (const { word, closest } of typos) {
      if (englishTypos?.has(word)) warnings.push(`Angliškas žodis „${word}“ — patikrink, ar jis čia reikalingas.`);
      else errors.push(`Galima rašybos klaida: „${word}“ → „${closest}“?`);
    }
  }

  return gateResult('lithuanian', errors, warnings, skipped);
}
