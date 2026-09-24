import fs from 'node:fs';
import path from 'node:path';
import type { LedgerEntry } from './costs.js';
import type { GateResult } from './gates/types.js';
import type { FactCheckOutput, FactSheet } from './schemas.js';

/**
 * Aggregates one evaluation round: every topic ran as a separate `article
 * --dry-run` job whose out dir is under `inDir/<n>/`. Primary metric: share
 * of topics whose article passed every gate. Articles that pass have every
 * factual claim supported by construction, so claim accuracy is reported for
 * the first attempt too (before revisions), where it is informative.
 */

export interface TopicResult {
  index: string;
  topic: string;
  status: 'ready' | 'failed' | 'aborted' | 'error';
  reason: string;
  attempts: number;
  costUsd: number;
  words: number | null;
  claimsVerified: number | null;
  claimsDemoted: number | null;
  firstAttemptFailures: Record<string, number>;
  finalFailures: string[];
  finalClaimStats: Record<string, number> | null;
  hunspellUnknown: number;
  editorUncertainties: number;
  /** Unreadable lines in the job's cost mirror (their spend is not counted). */
  ledgerBadLines: number;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Reads a job's cost mirror. A malformed line (e.g. a job killed mid-write)
 * is skipped and counted rather than thrown: a crash here would lose the whole
 * round's spend from state/costs.jsonl, which the monthly cap relies on.
 */
export function readLedger(file: string): { entries: LedgerEntry[]; badLines: number } {
  if (!fs.existsSync(file)) return { entries: [], badLines: 0 };
  const entries: LedgerEntry[] = [];
  let badLines = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as LedgerEntry;
      if (typeof entry.usd !== 'number' || typeof entry.ts !== 'string') throw new Error('bad entry');
      entries.push(entry);
    } catch {
      badLines += 1;
    }
  }
  return { entries, badLines };
}

export function collectTopic(dir: string, index: string): TopicResult {
  const meta = readJson<{ topic: string; exitCode: number; error?: string }>(path.join(dir, 'meta.json'));
  const summary = readJson<{ status: 'ready' | 'failed'; attempts: number; articleFile: string }>(path.join(dir, 'summary.json'));
  const gates = readJson<GateResult[]>(path.join(dir, 'gates.json')) ?? [];
  const firstGates = readJson<GateResult[]>(path.join(dir, 'attempt-1.gates.json')) ?? [];
  const factCheck = readJson<FactCheckOutput>(path.join(dir, 'factcheck.json'));
  const factSheet = readJson<FactSheet>(path.join(dir, 'fact-sheet.json'));
  const rawFactSheet = readJson<FactSheet>(path.join(dir, 'fact-sheet.raw.json'));
  const editor = readJson<{ uncertainties: string[] }>(path.join(dir, 'editor.json'));
  const { entries: ledger, badLines } = readLedger(path.join(dir, 'costs.jsonl'));

  let status: TopicResult['status'] = summary?.status ?? 'error';
  let reason = '';
  if (!summary) {
    const aborted = meta?.exitCode === 4;
    status = aborted ? 'aborted' : 'error';
    reason = (meta?.error ?? (gates[0]?.errors.join('; ') || 'no summary')).slice(0, 300);
  } else if (status === 'failed') {
    reason = 'gates failing after max revisions';
  }

  const firstAttemptFailures: Record<string, number> = {};
  for (const gate of firstGates) {
    if (!gate.passed) firstAttemptFailures[gate.gate] = gate.errors.length;
  }

  let words: number | null = null;
  if (summary?.articleFile && fs.existsSync(path.join(dir, summary.articleFile))) {
    const body = fs.readFileSync(path.join(dir, summary.articleFile), 'utf8').replace(/^---[\s\S]*?---/, '');
    words = (body.match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? []).length;
  }

  let finalClaimStats: Record<string, number> | null = null;
  if (factCheck) {
    finalClaimStats = {};
    for (const claim of factCheck.claims) finalClaimStats[claim.status] = (finalClaimStats[claim.status] ?? 0) + 1;
  }

  const lt = gates.find((gate) => gate.gate === 'lithuanian');

  return {
    index,
    topic: meta?.topic ?? index,
    status,
    reason,
    attempts: summary?.attempts ?? 0,
    costUsd: Number(ledger.reduce((sum, entry) => sum + entry.usd, 0).toFixed(4)),
    words,
    claimsVerified: factSheet ? factSheet.claims.length : null,
    claimsDemoted: factSheet && rawFactSheet ? rawFactSheet.claims.length - factSheet.claims.length : null,
    firstAttemptFailures,
    finalFailures: gates.flatMap((gate) => gate.errors.map((error) => `[${gate.gate}] ${error}`)),
    finalClaimStats,
    hunspellUnknown: lt ? lt.warnings.filter((warning) => warning.startsWith('Hunspell')).length : 0,
    editorUncertainties: editor?.uncertainties.length ?? 0,
    ledgerBadLines: badLines,
  };
}

export interface EvalSummary {
  round: string;
  topics: number;
  ready: number;
  passRate: number;
  firstAttemptPassRate: number;
  finalClaimAccuracy: number | null;
  totalCostUsd: number;
  avgCostPerTopicUsd: number;
  results: TopicResult[];
}

export function summarize(round: string, results: TopicResult[]): EvalSummary {
  const ready = results.filter((result) => result.status === 'ready').length;
  const firstPass = results.filter((result) => result.status === 'ready' && result.attempts === 1).length;
  let supported = 0;
  let checked = 0;
  for (const result of results) {
    if (!result.finalClaimStats) continue;
    supported += result.finalClaimStats.supported ?? 0;
    checked +=
      (result.finalClaimStats.supported ?? 0) +
      (result.finalClaimStats.unsupported ?? 0) +
      (result.finalClaimStats.contradicted ?? 0);
  }
  const total = results.reduce((sum, result) => sum + result.costUsd, 0);
  return {
    round,
    topics: results.length,
    ready,
    passRate: results.length ? ready / results.length : 0,
    firstAttemptPassRate: results.length ? firstPass / results.length : 0,
    finalClaimAccuracy: checked ? supported / checked : null,
    totalCostUsd: Number(total.toFixed(2)),
    avgCostPerTopicUsd: results.length ? Number((total / results.length).toFixed(2)) : 0,
    results,
  };
}

const pct = (value: number) => `${Math.round(value * 100)} %`;

export function renderReport(summary: EvalSummary): string {
  const lines = [
    `# Eval round ${summary.round}`,
    '',
    `- **Pass rate (all gates): ${pct(summary.passRate)}** (${summary.ready}/${summary.topics}) — target ≥ 70 %`,
    `- First-attempt pass rate: ${pct(summary.firstAttemptPassRate)}`,
    `- Claim accuracy of fact-checked final drafts: ${summary.finalClaimAccuracy === null ? 'n/a' : pct(summary.finalClaimAccuracy)}`,
    `- Cost: ${summary.totalCostUsd} USD total, ${summary.avgCostPerTopicUsd} USD per topic`,
    ...(() => {
      const bad = summary.results.reduce((sum, result) => sum + result.ledgerBadLines, 0);
      return bad ? [`- **Warning:** ${bad} unreadable cost-ledger line(s) skipped — real spend is higher than shown.`] : [];
    })(),
    '',
    '| # | Topic | Status | Attempts | Words | Claims (kept/demoted) | 1st-attempt failures | Hunspell unknown | Editor doubts | USD |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const result of summary.results) {
    const first = Object.entries(result.firstAttemptFailures)
      .map(([gate, count]) => `${gate}:${count}`)
      .join(' ') || '—';
    lines.push(
      `| ${result.index} | ${result.topic} | ${result.status} | ${result.attempts} | ${result.words ?? '—'} | ${result.claimsVerified ?? '—'}/${result.claimsDemoted ?? '—'} | ${first} | ${result.hunspellUnknown} | ${result.editorUncertainties} | ${result.costUsd} |`,
    );
  }
  lines.push('');
  for (const result of summary.results.filter((item) => item.status !== 'ready')) {
    lines.push(`## #${result.index} ${result.status}: ${result.reason}`, '');
    for (const failure of result.finalFailures.slice(0, 25)) lines.push(`- ${failure}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Reads `inDir/<n>/` topic dirs, writes the report, returns all ledger entries. */
export function aggregateRound(inDir: string, round: string): { summary: EvalSummary; ledger: LedgerEntry[] } {
  const dirs = fs
    .readdirSync(inDir)
    .filter((name) => fs.statSync(path.join(inDir, name)).isDirectory())
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const results = dirs.map((name) => collectTopic(path.join(inDir, name), name.replace(/^eval-/, '')));
  const ledger = dirs.flatMap((name) => readLedger(path.join(inDir, name, 'costs.jsonl')).entries);
  return { summary: summarize(round, results), ledger };
}
