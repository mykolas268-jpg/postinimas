import type { FactCheckOutput, FactSheet } from '../schemas.js';
import { gateResult, type GateResult } from './types.js';
import { EXAMPLE_MARKERS, prose, sentences, withoutQuotations } from './text.js';

/**
 * Evaluates the independent fact-check (model output) and adds a
 * deterministic number check: every price, percentage or number with a unit
 * in the article must appear in the fact sheet, unless its sentence is
 * clearly marked as an example.
 */

const NUMBER_WITH_UNIT =
  /\d[\d\s]*(?:[.,]\d+)?\s?(?:€|EUR|USD|\$|%|proc\.|val\.|min\.?|sek\.?|mln\.?|tūkst\.?|GB|TB|kartų|kartus|dien(?:ų|as|os)|mėn\.?|mėnes(?:ių|iai|io)|metų|kalbų|žodžių|simbolių)/giu;

function digits(value: string): string {
  return value.replace(/[^\d]/g, '');
}

/** Every number in a text, normalised to its digits ("1 200,50" → "120050"). */
export function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/\d(?:[\d\s.,]*\d)?/g)) {
    found.add(digits(match[0]));
    // "20–30" and "1,5–2" are two numbers; so are thousands written "1,200" vs "1 200".
    for (const part of match[0].split(/\s+/)) if (/\d/.test(part)) found.add(digits(part));
  }
  return found;
}

export function unsupportedNumbers(body: string, factSheet: FactSheet, houseFacts: string[] = []): string[] {
  const known = new Set<string>();
  for (const text of [
    ...factSheet.claims.map((claim) => `${claim.claim} ${claim.value ?? ''}`),
    ...houseFacts,
  ]) {
    for (const number of numbersIn(text)) known.add(number);
  }
  const problems: string[] = [];
  for (const sentence of sentences(withoutQuotations(prose(body)))) {
    if (EXAMPLE_MARKERS.test(sentence)) continue;
    for (const match of sentence.matchAll(NUMBER_WITH_UNIT)) {
      const number = digits(match[0]);
      if (number.length === 0) continue;
      if (!known.has(number)) {
        problems.push(`Skaičius „${match[0].trim()}“ nerastas faktų lape: „${sentence.slice(0, 140)}“`);
      }
    }
  }
  return problems;
}

export function checkFactCheck(
  result: FactCheckOutput,
  factSheet: FactSheet,
  body: string,
  houseFacts: string[] = [],
): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const claimIds = new Set(factSheet.claims.map((claim) => claim.id));

  for (const claim of result.claims) {
    switch (claim.status) {
      case 'unsupported':
        errors.push(`Nepagrįstas teiginys: „${claim.text}“ — ${claim.note}`);
        break;
      case 'contradicted':
        errors.push(`Teiginys prieštarauja šaltiniams: „${claim.text}“ — ${claim.note}`);
        break;
      case 'example':
        if (!EXAMPLE_MARKERS.test(claim.text)) {
          errors.push(`Pavyzdys aiškiai nepažymėtas kaip pavyzdys: „${claim.text}“`);
        }
        break;
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

  errors.push(...unsupportedNumbers(body, factSheet, houseFacts));
  return gateResult('factcheck', errors, warnings);
}
