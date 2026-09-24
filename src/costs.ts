import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';
import { log } from './log.js';

/**
 * Cost accounting and hard caps. Every API call is priced from its usage and
 * appended to state/costs.jsonl. Before a call, the guard checks that the
 * call's worst case fits under the per-run, per-article and monthly caps;
 * if the ledger can't be read, the run stops (fail closed).
 */

export interface UsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  webSearches: number;
  webFetches: number;
}

export interface LedgerEntry extends UsageRecord {
  ts: string;
  run: string;
  step: string;
  article?: string;
  usd: number;
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export function priceUsage(config: Config, usage: UsageRecord): number {
  const price = config.pricing.models[usage.model];
  if (!price) throw new Error(`No price configured for model "${usage.model}"`);
  const perToken = (usdPerMillion: number) => usdPerMillion / 1_000_000;
  return (
    usage.inputTokens * perToken(price.input) +
    usage.outputTokens * perToken(price.output) +
    usage.cacheWriteTokens * perToken(price.cacheWrite) +
    usage.cacheReadTokens * perToken(price.cacheRead) +
    (usage.webSearches * config.pricing.webSearchPer1000) / 1000
  );
}

/** Rough token count for budget estimates; Lithuanian averages ~3 chars/token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export function worstCaseUsd(
  config: Config,
  model: string,
  inputChars: number,
  maxOutputTokens: number,
): number {
  return priceUsage(config, {
    model,
    inputTokens: Math.ceil(inputChars / 3),
    outputTokens: maxOutputTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    webSearches: 0,
    webFetches: 0,
  });
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export class CostLedger {
  private readonly file: string | null;
  private readonly persist: boolean;
  private readonly mirrorFile: string | null;
  private readonly entries: LedgerEntry[] = [];
  private monthToDateBefore = 0;
  private alerted = new Set<number>();

  /**
   * @param stateDir directory holding costs.jsonl (read for month-to-date);
   *   null means no history (tests).
   * @param persist append new entries to costs.jsonl; false for dry runs,
   *   which still enforce every cap in memory.
   * @param mirrorFile also append every entry here as it happens (eval runs
   *   collect spend from their artifacts, even if the run later crashes).
   */
  constructor(
    private readonly config: Config,
    private readonly runId: string,
    stateDir: string | null,
    {
      persist = true,
      now = new Date(),
      mirrorFile = null,
    }: { persist?: boolean; now?: Date; mirrorFile?: string | null } = {},
  ) {
    this.file = stateDir ? path.join(stateDir, 'costs.jsonl') : null;
    this.persist = persist;
    this.mirrorFile = mirrorFile;
    const source = this.file;
    if (source && fs.existsSync(source)) {
      const month = monthKey(now);
      let lineNo = 0;
      try {
        for (const line of fs.readFileSync(source, 'utf8').split('\n')) {
          lineNo += 1;
          if (!line.trim()) continue;
          const entry = JSON.parse(line) as LedgerEntry;
          if (typeof entry.usd !== 'number') throw new Error('missing usd');
          if (entry.ts.slice(0, 7) === month) this.monthToDateBefore += entry.usd;
        }
      } catch (error) {
        throw new Error(
          `Cost ledger ${source} is unreadable at line ${lineNo} (${String(error)}). ` +
            'Refusing to run without a trustworthy ledger.',
        );
      }
    }
  }

  get runTotal(): number {
    return this.entries.reduce((sum, entry) => sum + entry.usd, 0);
  }

  articleTotal(article: string): number {
    return this.entries
      .filter((entry) => entry.article === article)
      .reduce((sum, entry) => sum + entry.usd, 0);
  }

  get monthToDate(): number {
    return this.monthToDateBefore + this.runTotal;
  }

  get runEntries(): readonly LedgerEntry[] {
    return this.entries;
  }

  /** Throws BudgetExceededError if a call costing up to `worstUsd` could break a cap. */
  assertAffordable(worstUsd: number, article?: string): void {
    const { perRunUsd, perArticleUsd, monthlyUsd } = this.config.caps;
    if (this.runTotal + worstUsd > perRunUsd) {
      throw new BudgetExceededError(
        `Per-run cap: spent ${this.runTotal.toFixed(2)} USD + up to ${worstUsd.toFixed(2)} USD > ${perRunUsd} USD`,
      );
    }
    if (article && this.articleTotal(article) + worstUsd > perArticleUsd) {
      throw new BudgetExceededError(
        `Per-article cap: spent ${this.articleTotal(article).toFixed(2)} USD + up to ${worstUsd.toFixed(2)} USD > ${perArticleUsd} USD`,
      );
    }
    if (this.monthToDate + worstUsd > monthlyUsd) {
      throw new BudgetExceededError(
        `Monthly cap: ${this.monthToDate.toFixed(2)} USD + up to ${worstUsd.toFixed(2)} USD > ${monthlyUsd} USD`,
      );
    }
  }

  record(step: string, usage: UsageRecord, article?: string): LedgerEntry {
    const entry: LedgerEntry = {
      ts: new Date().toISOString(),
      run: this.runId,
      step,
      ...(article ? { article } : {}),
      ...usage,
      usd: Number(priceUsage(this.config, usage).toFixed(6)),
    };
    this.entries.push(entry);
    if (this.file && this.persist) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
    }
    if (this.mirrorFile) {
      fs.mkdirSync(path.dirname(this.mirrorFile), { recursive: true });
      fs.appendFileSync(this.mirrorFile, `${JSON.stringify(entry)}\n`);
    }
    log.info('cost', { step, model: usage.model, usd: entry.usd, runTotal: this.runTotal });

    for (const fraction of this.config.caps.alertAtFractions) {
      if (!this.alerted.has(fraction) && this.monthToDate >= fraction * this.config.caps.monthlyUsd) {
        this.alerted.add(fraction);
        log.warn('cost_alert', {
          fraction,
          monthToDate: Number(this.monthToDate.toFixed(2)),
          cap: this.config.caps.monthlyUsd,
        });
      }
    }
    return entry;
  }
}
