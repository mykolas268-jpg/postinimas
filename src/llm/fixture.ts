import fs from 'node:fs';
import path from 'node:path';
import type { CostLedger } from '../costs.js';
import type { LlmClient, ResearchCall, ResearchResult, StructuredCall } from './client.js';

/**
 * Offline client for tests and `--fixtures` dry runs. Replays recorded
 * outputs from `<dir>/<step>.json` (numbered `<step>.2.json`, … for repeated
 * calls) and records zero-cost usage so the ledger flow is exercised.
 */
export class FixtureLlmClient implements LlmClient {
  private readonly calls = new Map<string, number>();

  constructor(
    private readonly dir: string,
    private readonly ledger: CostLedger,
  ) {}

  private load(step: string): unknown {
    const count = (this.calls.get(step) ?? 0) + 1;
    this.calls.set(step, count);
    const numbered = path.join(this.dir, `${step}.${count}.json`);
    const plain = path.join(this.dir, `${step}.json`);
    const file = count > 1 && fs.existsSync(numbered) ? numbered : plain;
    if (!fs.existsSync(file)) {
      throw new Error(`Fixture missing for step "${step}": ${file}`);
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  private recordZero(step: string, model: string, article?: string): void {
    this.ledger.record(
      step,
      {
        model,
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        webSearches: 0,
        webFetches: 0,
      },
      article,
    );
  }

  async structured<T>(call: StructuredCall<T>): Promise<T> {
    const data = call.schema.parse(this.load(call.step));
    this.recordZero(call.step, call.model, call.article);
    return data;
  }

  async research(call: ResearchCall): Promise<ResearchResult> {
    const data = this.load(call.step) as ResearchResult;
    this.recordZero(call.step, call.model, call.article);
    return data;
  }
}
