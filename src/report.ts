import type { LedgerEntry } from './costs.js';
import type { GateResult } from './gates/types.js';
import type { EditorOutput, FactCheckOutput, FactSheet } from './schemas.js';

/**
 * The PR description the owner reviews (Lithuanian). The claim/source table
 * comes first so a real review is fast.
 */

export interface ReportInput {
  mode: 'shadow' | 'approval' | 'auto';
  status: 'ready' | 'failed';
  title: string;
  slug: string;
  type: string;
  cluster: string;
  primaryKeyword: string;
  words: number;
  attempts: number;
  factSheet: FactSheet;
  factCheck: FactCheckOutput | null;
  editor: EditorOutput | null;
  gates: GateResult[];
  costs: readonly LedgerEntry[];
  experienceQuestion: string;
  similar: { slug: string; title: string; score: number } | null;
  demotedClaims: number;
}

const STATUS_LT: Record<string, string> = {
  supported: 'patvirtinta',
  unsupported: 'NEPAGRĮSTA',
  contradicted: 'PRIEŠTARAUJA',
  example: 'pavyzdys',
  opinion: 'nuomonė',
};

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function claimSources(factSheet: FactSheet, ids: string[]): string {
  const links = ids.flatMap((id) => {
    const claim = factSheet.claims.find((item) => item.id === id);
    if (!claim) return id === 'HOUSE' ? ['verslas.ai paslaugos aprašas'] : [];
    return claim.sources.map((source) => `[${source.publisher}${source.tier === 'primary' ? ' (pirminis)' : ''}](${source.url})`);
  });
  return [...new Set(links)].join(', ') || '—';
}

export function buildPrBody(input: ReportInput): string {
  const out: string[] = [];

  if (input.mode === 'shadow') {
    out.push(
      '> **Shadow režimas.** Šio PR nesujunk. Tai bandomasis straipsnis: įvertink jį komentaru `/ivertinimas <1–5> <pastabos>`. Pagal įvertinimus derinami promptai ir svoriai.',
      '',
    );
  }
  if (input.status === 'failed') {
    out.push('> **Straipsnis nepraėjo visų vartų** po maksimalaus pataisymų skaičiaus — jis nepublikuojamas.', '');
  }

  out.push('## Santrauka', '');
  out.push('| Laukas | Reikšmė |', '|---|---|');
  out.push(`| Antraštė | ${cell(input.title)} |`);
  out.push(`| Adresas | \`/straipsniai/${input.slug}\` |`);
  out.push(`| Tipas / tema | ${input.type} / ${input.cluster} |`);
  out.push(`| Pagrindinis raktažodis | ${cell(input.primaryKeyword)} (hipotezė, ne paieškos duomenys) |`);
  out.push(`| Apimtis | ${input.words} žodž. |`);
  out.push(`| Rašymo bandymai | ${input.attempts} |`);
  const total = input.costs.reduce((sum, entry) => sum + entry.usd, 0);
  out.push(`| Kaina | ${total.toFixed(2)} USD |`);
  if (input.similar && input.similar.score >= 0.3) {
    out.push(
      `| Panašus straipsnis | [${cell(input.similar.title)}](/straipsniai/${input.similar.slug}) (panašumas ${input.similar.score.toFixed(2)}) — gal verčiau atnaujinti? |`,
    );
  }
  out.push('');

  out.push('## Faktų lentelė', '');
  if (input.factCheck) {
    out.push('| # | Teiginys straipsnyje | Statusas | Šaltiniai |', '|---|---|---|---|');
    input.factCheck.claims.forEach((claim, index) => {
      out.push(
        `| ${index + 1} | ${cell(claim.text)} | ${STATUS_LT[claim.status] ?? claim.status} | ${claimSources(input.factSheet, claim.claimIds)} |`,
      );
    });
  } else {
    out.push('_Faktų tikrinimas nevyko (straipsnis nepraėjo ankstesnių vartų)._');
  }
  out.push('');

  out.push('## Rizikos ir neaiškumai', '');
  const risks = [
    ...input.factSheet.conflicts.map((conflict) => `Šaltiniai nesutaria: ${conflict.description}`),
    ...input.factSheet.unknowns.slice(0, 12).map((unknown) => `Nepatvirtinta: ${unknown}`),
    ...(input.demotedClaims > 0 ? [`Atmesta teiginių dėl nepakankamų šaltinių: ${input.demotedClaims}.`] : []),
  ];
  out.push(...(risks.length ? risks.map((risk) => `- ${risk}`) : ['- Nėra.']), '');

  out.push('## Lietuvių kalba', '');
  const uncertainties = input.editor?.uncertainties ?? [];
  out.push(`**Redaktoriaus neaiškumai (${uncertainties.length}):**`);
  out.push(...(uncertainties.length ? uncertainties.map((item) => `- ${item}`) : ['- Nėra.']), '');
  const changes = input.editor?.changes ?? [];
  if (changes.length) {
    out.push(`<details><summary>Redaktoriaus pakeitimai (${changes.length})</summary>`, '');
    for (const change of changes.slice(0, 40)) {
      out.push(`- „${change.before}“ → „${change.after}“ — ${change.reason}`);
    }
    out.push('', '</details>', '');
  }

  out.push('## Vartai', '');
  out.push('| Vartai | Rezultatas | Klaidos | Įspėjimai |', '|---|---|---|---|');
  for (const gate of input.gates) {
    const result = gate.skipped ? 'praleista' : gate.passed ? 'praėjo' : 'NEPRAĖJO';
    out.push(`| ${gate.gate} | ${result} | ${gate.errors.length} | ${gate.warnings.length} |`);
  }
  out.push('');
  const findings = input.gates.flatMap((gate) => [
    ...gate.errors.map((message) => `- **${gate.gate}**: ${message}`),
    ...gate.warnings.map((message) => `- ${gate.gate}: ${message}`),
  ]);
  if (findings.length) {
    out.push(`<details><summary>Visi vartų pranešimai (${findings.length})</summary>`, '', ...findings, '', '</details>', '');
  }

  out.push('## Kaina', '');
  out.push('| Žingsnis | Modelis | Įvestis | Išvestis | Paieškos | USD |', '|---|---|---|---|---|---|');
  for (const entry of input.costs) {
    out.push(
      `| ${entry.step} | ${entry.model} | ${entry.inputTokens + entry.cacheReadTokens + entry.cacheWriteTokens} | ${entry.outputTokens} | ${entry.webSearches} | ${entry.usd.toFixed(3)} |`,
    );
  }
  out.push('');

  out.push('## Tavo patirtis (neprivaloma)', '');
  out.push(input.experienceQuestion || '—');
  out.push('', 'Jei atsakysi, tavo žodžiai (tik kalbos pataisymai) bus įdėti į straipsnį kaip pažymėtas blokas.', '');

  return out.join('\n');
}
