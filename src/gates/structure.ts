import { gateResult, type GateResult } from './types.js';
import { headings, withoutCodeBlocks } from './text.js';

/**
 * Article structure (spec § 7) and MDX safety. The MDX checks duplicate the
 * site's `check:content --strict` on purpose: failing here costs a revision
 * loop, failing in the verify job costs a whole run.
 */

const ALLOWED_COMPONENTS = new Set(['Callout', 'ProseImage']);
const CALLOUT_TYPES = new Set(['info', 'tip', 'warning']);

export interface StructureInput {
  body: string;
  isLegal: boolean;
}

export function checkStructure(input: StructureInput): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const code = withoutCodeBlocks(input.body);

  // MDX safety
  if (/^\s*(import|export)\s/m.test(code)) errors.push('MDX: import/export neleidžiami.');
  const withoutInlineCode = code.replace(/`[^`\n]*`/g, '');
  if (/\{[^}\n]*\}/.test(withoutInlineCode)) {
    errors.push('MDX: riestiniai skliaustai {…} už kodo bloko neleidžiami (JS išraiška).');
  }
  for (const match of withoutInlineCode.matchAll(/<\/?([A-Za-z][\w.]*)/g)) {
    const name = match[1] ?? '';
    if (!ALLOWED_COMPONENTS.has(name)) errors.push(`MDX: komponentas ar HTML žymė <${name}> neleidžiama.`);
  }
  for (const match of withoutInlineCode.matchAll(/<Callout\s+type="([^"]*)"/g)) {
    if (!CALLOUT_TYPES.has(match[1] ?? '')) errors.push(`Callout type="${match[1]}" neleidžiamas (info, tip, warning).`);
  }

  // Answer-first intro
  const firstBlock = code.trim().split(/\n\s*\n/)[0] ?? '';
  if (/^(#|<|[-*+]\s|\d+\.\s|\|)/.test(firstBlock.trim())) {
    errors.push('Straipsnis turi prasidėti atsakymu (2–3 sakinių pastraipa), ne antrašte ar bloku.');
  }

  // "Trumpai" box with 3–5 bullets near the start
  // Attribute order does not matter: <Callout title="Trumpai" type="info"> is fine too.
  const trumpai = [...code.matchAll(/<Callout\b([^>]*)>([\s\S]*?)<\/Callout>/g)].find(
    (match) => /\btype="info"/.test(match[1] ?? '') && /\btitle="Trumpai"/.test(match[1] ?? ''),
  );
  if (!trumpai) {
    errors.push('Trūksta <Callout type="info" title="Trumpai"> bloko.');
  } else {
    const bullets = (trumpai[2] ?? '').split('\n').filter((line) => /^\s*[-*]\s+\S/.test(line)).length;
    if (bullets < 3 || bullets > 5) errors.push(`„Trumpai“ bloke ${bullets} punktai (reikia 3–5).`);
    if ((trumpai.index ?? 0) > 1500) warnings.push('„Trumpai“ blokas toli nuo pradžios.');
  }

  // Required sections
  const h2 = headings(input.body).filter((heading) => heading.level === 2);
  const has = (pattern: RegExp) => h2.some((heading) => pattern.test(heading.text));
  if (!has(/kam\s+(tai\s+)?aktualu/i)) errors.push('Trūksta skyriaus „Kam tai aktualu, o kam ne“.');
  if (!has(/ką\s+daryti\s+dabar/i)) errors.push('Trūksta skyriaus „Ką daryti dabar“.');
  if (!has(/rizik|ribojim|apribojim|trūkum/i)) errors.push('Trūksta skyriaus apie ribojimus ir rizikas.');
  if (/^##\s+(D\.?U\.?K\.?|Dažniausi klausimai|Šaltiniai)\s*$/im.test(code)) {
    errors.push('DUK ir šaltiniai rašomi į frontmatter (faq, sources), ne į tekstą.');
  }

  // Question-style H2s
  const questions = h2.filter((heading) => heading.text.trim().endsWith('?')).length;
  if (h2.length >= 4 && questions < Math.ceil(h2.length / 3)) {
    warnings.push(`Tik ${questions} iš ${h2.length} H2 suformuluoti klausimu.`);
  }

  // Legal note
  const legalNote = [...code.matchAll(/<Callout\b([^>]*)>/g)].some(
    (match) => /\btype="warning"/.test(match[1] ?? '') && /\btitle="Ne teisinė konsultacija"/.test(match[1] ?? ''),
  );
  if (input.isLegal && !legalNote) {
    errors.push('Teisinei temai reikia <Callout type="warning" title="Ne teisinė konsultacija">.');
  }

  return gateResult('structure', errors, warnings);
}
