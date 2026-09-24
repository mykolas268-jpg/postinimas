import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runArticle } from '../src/article.js';
import { CostLedger } from '../src/costs.js';
import { FixtureLlmClient } from '../src/llm/fixture.js';
import { readFrontmatter } from '../src/site/registry.js';
import { ROOT, fixtures, pc } from './helpers.js';

describe('article flow (fixtures, offline)', () => {
  it('revises a failing draft, passes every gate and packages the article', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'article-'));
    const ledger = new CostLedger(pc.config, 'test', null, { persist: false });
    const cluster = pc.clusters.find((item) => item.key === 'di-irankiai')!;

    const outcome = await runArticle(
      { topic: 'ExampleVideo 2.0 (testas)', type: 'news', cluster, keyword: 'AI video įrankis' },
      {
        pc,
        llm: new FixtureLlmClient(path.join(fixtures, 'article'), ledger),
        ledger,
        siteDir: path.join(fixtures, 'site'),
        outDir,
        promptsDir: path.join(ROOT, 'prompts'),
        today: '2026-09-24',
        mode: 'shadow',
        checkLinks: false,
        spellcheck: () => [],
      },
    );

    expect(outcome.status).toBe('ready');
    expect(outcome.slug).toBe('ai-video-irankis-examplevideo');

    // Attempt 1 failed on length, attempt 2 passed.
    const first = JSON.parse(fs.readFileSync(path.join(outDir, 'attempt-1.gates.json'), 'utf8'));
    expect(first.find((gate: { gate: string }) => gate.gate === 'seo').passed).toBe(false);
    expect(ledger.runEntries.map((entry) => entry.step)).toEqual([
      'research', 'factsheet', 'write', 'edit', 'revise', 'edit', 'factcheck',
    ]);

    const { data } = readFrontmatter(fs.readFileSync(outcome.articleFile!, 'utf8'));
    expect(data).toMatchObject({ aiAssisted: true, author: 'mykolas-gustas', type: 'news', date: '2026-09-24' });
    expect((data.sources as unknown[]).length).toBeGreaterThan(0);

    const prBody = fs.readFileSync(outcome.prBodyFile!, 'utf8');
    expect(prBody).toContain('Shadow režimas');
    expect(prBody).toContain('## Faktų lentelė');
    expect(prBody.indexOf('## Faktų lentelė')).toBeLessThan(prBody.indexOf('## Vartai'));
  });

  it('aborts topics on the never-cover list before spending anything', async () => {
    const ledger = new CostLedger(pc.config, 'test', null, { persist: false });
    const outcome = await runArticle(
      { topic: 'Draudžiama tema', type: 'news', cluster: pc.clusters[0]! },
      {
        pc: { ...pc, neverCover: ['draudžiama'] },
        llm: new FixtureLlmClient(path.join(fixtures, 'article'), ledger),
        ledger,
        siteDir: path.join(fixtures, 'site'),
        outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'article-')),
        promptsDir: path.join(ROOT, 'prompts'),
        today: '2026-09-24',
        mode: 'shadow',
        checkLinks: false,
      },
    );
    expect(outcome.status).toBe('aborted');
    expect(ledger.runEntries).toHaveLength(0);
  });
});
