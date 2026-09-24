import type { FactCheckOutput, FactSheet } from '../schemas.js';
import { gateResult, type GateResult } from './types.js';
import { EXAMPLE_MARKERS, prose, sentences, withoutQuotations } from './text.js';

/**
 * Evaluates the independent fact-check (model output) and adds a
 * deterministic number check: every price, percentage or number with a unit
 * in the article must appear in the fact sheet, unless its sentence is
 * clearly marked as an example.
 */

// A number starts only at a number boundary and has at most four thousands
// groups ("1 500 000"): linear time on any input (the old `\d[\d\s]*` form
// restarted at every digit — quadratic — and read "20 30 %" as 2030).
const NUMBER_WITH_UNIT =
  /(?<![\d.,])\d+(?:[ \u00a0\u202f]\d{3}){0,4}(?:[.,]\d+)?\s?(?:€|EUR|USD|\$|%|proc\.|val\.|min\.?|sek\.?|mln\.?|tūkst\.?|GB|TB|kartų|kartus|dien(?:ų|as|os)|mėn\.?|mėnes(?:ių|iai|io)|metų|kalbų|žodžių|simbolių)/giu;

function digits(value: string): string {
  return value.replace(/[^\d]/g, '');
}

const SCALE: [RegExp, number][] = [
  [/^\s?(?:tūkst\.?|thousand)/iu, 1e3],
  [/^\s?(?:mln\.?|million|milijon)/iu, 1e6],
  [/^\s?(?:mlrd\.?|billion|milijard)/iu, 1e9],
];

/** "1,5" / "1.5" → 1.5; "1 500" / "1,500" → 1500 (a 3-digit group is thousands). */
function numericValue(raw: string): number | null {
  const compact = raw.replace(/\s/g, '');
  const grouped = compact.match(/^(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{1,2}))?$/);
  if (!grouped) return null;
  return Number(`${grouped[1]!.replace(/[.,]/g, '')}.${grouped[2] ?? '0'}`);
}

/** A number's digits and, when a scale word follows it, its full value. */
function valuesAt(text: string, index: number, raw: string): string[] {
  const values = [digits(raw)];
  const scale = SCALE.find(([pattern]) => pattern.test(text.slice(index + raw.length)))?.[1];
  const value = numericValue(raw);
  if (scale && value !== null) values.push(String(Math.round(value * scale)));
  return values;
}

/**
 * Every number in a text, normalised to its digits ("1 200,50" → "120050").
 * Amounts with a scale word also yield their full value, so "50 tūkst. €",
 * "EUR 50,000" and "50 000 €" match each other, as do "1,5 mln." and "1 500 000".
 */
export function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/\d(?:[\d\s.,]*\d)?/g)) {
    for (const value of valuesAt(text, match.index ?? 0, match[0])) found.add(value);
    // "20–30" and "1,5–2" are two numbers; so are thousands written "1,200" vs "1 200".
    for (const part of match[0].split(/\s+/)) if (/\d/.test(part)) found.add(digits(part));
  }
  return found;
}

/** `text` is everything readers see: title, excerpt, MDX body and FAQ. */
export function unsupportedNumbers(text: string, factSheet: FactSheet, houseFacts: string[] = []): string[] {
  const known = new Set<string>();
  for (const source of [
    ...factSheet.claims.map((claim) => `${claim.claim} ${claim.value ?? ''}`),
    ...houseFacts,
  ]) {
    for (const number of numbersIn(source)) known.add(number);
  }
  const problems: string[] = [];
  for (const sentence of sentences(withoutQuotations(prose(text)))) {
    if (EXAMPLE_MARKERS.test(sentence)) continue;
    for (const match of sentence.matchAll(NUMBER_WITH_UNIT)) {
      const raw = match[0].replace(/[^\d\s.,][\s\S]*$/, '').replace(/[\s.,]+$/, ''); // "1 200,50 €" → "1 200,50"
      if (digits(raw).length === 0) continue;
      if (!valuesAt(sentence, match.index ?? 0, raw).some((value) => known.has(value))) {
        problems.push(`Skaičius „${match[0].trim()}“ nerastas faktų lape: „${sentence.slice(0, 140)}“`);
      }
    }
  }
  return problems;
}

/**
 * The article sentence a fact-check quote came from: the checker may quote
 * only part of a sentence ("kavinė sutaupytų 5 val." from "Pavyzdžiui, kavinė
 * sutaupytų 5 val."), so example markers are judged on the article itself.
 */
export function sourceSentence(quote: string, articleSentences: string[]): string | null {
  const quoteWords = (quote.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  if (quoteWords.length === 0) return null;
  let best: { sentence: string; share: number } | null = null;
  for (const sentence of articleSentences) {
    const lower = sentence.toLowerCase();
    const share = quoteWords.filter((word) => lower.includes(word)).length / quoteWords.length;
    if (!best || share > best.share) best = { sentence, share };
  }
  return best && best.share >= 0.8 ? best.sentence : null;
}

export function checkFactCheck(
  result: FactCheckOutput,
  factSheet: FactSheet,
  text: string,
  houseFacts: string[] = [],
): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const claimIds = new Set(factSheet.claims.map((claim) => claim.id));
  const articleSentences = sentences(prose(text));

  for (const claim of result.claims) {
    switch (claim.status) {
      case 'unsupported':
        errors.push(`Nepagrįstas teiginys: „${claim.text}“ — ${claim.note}`);
        break;
      case 'contradicted':
        errors.push(`Teiginys prieštarauja šaltiniams: „${claim.text}“ — ${claim.note}`);
        break;
      case 'example': {
        const sentence = sourceSentence(claim.text, articleSentences);
        if (!EXAMPLE_MARKERS.test(claim.text) && !(sentence && EXAMPLE_MARKERS.test(sentence))) {
          errors.push(`Pavyzdys aiškiai nepažymėtas kaip pavyzdys: „${claim.text}“`);
        }
        break;
      }
      case 'opinion':
        warnings.push(`Nuomonė: „${claim.text}“`);
        break;
      case 'supported':
        for (const id of claim.claimIds) {
          if (id !== 'HOUSE' && !claimIds.has(id)) {
            errors.push(`Nuoroda į neegzistuojantį faktą ${id}: „${claim.text}“`);
          }
        }
        if (claim.claimIds.length === 0) errors.push(`Patvirtintas teiginys be fakto ID: „${claim.text}“`);
        break;
    }
  }

  errors.push(...unsupportedNumbers(text, factSheet, houseFacts));
  return gateResult('factcheck', errors, warnings);
}
