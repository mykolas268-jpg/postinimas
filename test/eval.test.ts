import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregateRound, renderReport } from '../src/eval.js';

function topicDir(root: string, name: string, files: Record<string, unknown>): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), typeof content === 'string' ? content : JSON.stringify(content));
  }
}

describe('eval aggregation', () => {
  it('computes pass rate, claim accuracy and spend across topics', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-'));
    const gate = (name: string, passed: boolean) => ({ gate: name, passed, errors: passed ? [] : ['x'], warnings: [] });
    topicDir(root, 'eval-1', {
      'meta.json': { topic: 'A', exitCode: 0 },
      'summary.json': { status: 'ready', attempts: 1, articleFile: 'a.mdx' },
      'a.mdx': '---\ntitle: x\n---\n\nVienas du trys.',
      'gates.json': [gate('seo', true)],
      'attempt-1.gates.json': [gate('seo', true)],
      'factcheck.json': { claims: [{ status: 'supported' }, { status: 'supported' }, { status: 'opinion' }] },
      'costs.jsonl': `${JSON.stringify({ usd: 2.5 })}\n`,
    });
    topicDir(root, 'eval-2', {
      'meta.json': { topic: 'B', exitCode: 3 },
      'summary.json': { status: 'failed', attempts: 3, articleFile: 'b.mdx' },
      'gates.json': [gate('lithuanian', false)],
      'attempt-1.gates.json': [gate('lithuanian', false), gate('seo', false)],
      'costs.jsonl': `${JSON.stringify({ usd: 4 })}\n`,
    });
    topicDir(root, 'eval-3', { 'meta.json': { topic: 'C', exitCode: 1, error: 'auth' } });

    const { summary, ledger } = aggregateRound(root, '7');
    expect(summary.passRate).toBeCloseTo(1 / 3);
    expect(summary.firstAttemptPassRate).toBeCloseTo(1 / 3);
    expect(summary.finalClaimAccuracy).toBe(1);
    expect(summary.totalCostUsd).toBe(6.5);
    expect(ledger).toHaveLength(2);
    expect(summary.results.map((result) => result.status)).toEqual(['ready', 'failed', 'error']);
    expect(summary.results[1]!.firstAttemptFailures).toEqual({ lithuanian: 1, seo: 1 });
    expect(renderReport(summary)).toContain('Pass rate (all gates): 33 %');
  });
});
