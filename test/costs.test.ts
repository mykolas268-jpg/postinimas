import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BudgetExceededError, CostLedger, priceUsage } from '../src/costs.js';
import { config } from './helpers.js';

const usage = (model: string, inputTokens: number, outputTokens: number, webSearches = 0) => ({
  model,
  inputTokens,
  outputTokens,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  webSearches,
  webFetches: 0,
});

describe('priceUsage', () => {
  it('prices tokens and web searches from config', () => {
    // Opus 5.5: $4 in / $20 out per MTok; searches $10 per 1,000
    expect(priceUsage(config, usage('claude-opus-5-5', 1_000_000, 100_000))).toBeCloseTo(6);
    expect(priceUsage(config, usage('claude-sonnet-5', 0, 0, 10))).toBeCloseTo(0.1);
  });

  it('refuses unknown models', () => {
    expect(() => priceUsage(config, usage('claude-unknown', 1, 1))).toThrow(/No price/);
  });
});

describe('CostLedger caps', () => {
  it('blocks a call whose worst case would break the per-run cap', () => {
    const ledger = new CostLedger(config, 'test', null);
    ledger.record('write', usage('claude-opus-5-5', 1_000_000, 300_000)); // $10
    expect(() => ledger.assertAffordable(3)).toThrow(BudgetExceededError);
    expect(() => ledger.assertAffordable(1)).not.toThrow();
  });

  it('enforces the per-article cap', () => {
    const ledger = new CostLedger(config, 'test', null);
    ledger.record('write', usage('claude-opus-5-5', 1_000_000, 150_000), 'a'); // $7
    expect(() => ledger.assertAffordable(2, 'a')).toThrow(/Per-article/);
    expect(() => ledger.assertAffordable(2, 'b')).not.toThrow();
  });

  it('counts this month from the persisted ledger and ignores other months', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
    const month = new Date().toISOString().slice(0, 7);
    fs.writeFileSync(
      path.join(dir, 'costs.jsonl'),
      [
        JSON.stringify({ ts: `${month}-01T00:00:00Z`, usd: 145 }),
        JSON.stringify({ ts: '2020-01-01T00:00:00Z', usd: 999 }),
      ].join('\n'),
    );
    const ledger = new CostLedger(config, 'test', dir);
    expect(ledger.monthToDate).toBe(145);
    expect(() => ledger.assertAffordable(6)).toThrow(/Monthly/);
  });

  it('fails closed on an unreadable ledger', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
    fs.writeFileSync(path.join(dir, 'costs.jsonl'), '{not json\n');
    expect(() => new CostLedger(config, 'test', dir)).toThrow(/unreadable/);
  });

  it('does not write in dry runs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
    const ledger = new CostLedger(config, 'test', dir, { persist: false });
    ledger.record('write', usage('claude-sonnet-5', 10, 10));
    expect(fs.existsSync(path.join(dir, 'costs.jsonl'))).toBe(false);
  });
});
