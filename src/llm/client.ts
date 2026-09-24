import type { z } from 'zod';
import type { UsageRecord } from '../costs.js';

/**
 * The only interface the pipeline uses to talk to a model. Models return
 * data; they never get tools with side effects. Deterministic code does all
 * git, HTTP and notification work.
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface CallBase {
  /** Step name, used for logs, the cost ledger and fixtures. */
  step: string;
  model: string;
  /** Large static instructions — cached. */
  system: string;
  /**
   * Content that stays byte-identical across this article's calls of the same
   * step (the writer's brief, the fact-check's fact sheet). Sent before `user`
   * with its own cache breakpoint, so revisions read it at the cache price.
   */
  userPrefix?: string;
  /** Per-request content. */
  user: string;
  maxTokens: number;
  effort: Effort;
  /** Article slug/topic key for the per-article cost cap. */
  article?: string;
}

export interface StructuredCall<T> extends CallBase {
  schema: z.ZodType<T>;
}

export interface ResearchCall extends CallBase {
  maxSearches: number;
  maxFetches: number;
  fetchMaxContentTokens: number;
  blockedDomains: string[];
}

/** A page the research model actually retrieved or saw in search results. */
export interface SeenSource {
  url: string;
  title: string | null;
  via: 'search' | 'fetch';
  retrievedAt: string | null;
}

export interface ResearchResult {
  /** The model's research notes (text blocks). */
  notes: string;
  /** Every URL that appeared in a web_search or web_fetch result. */
  seen: SeenSource[];
}

export interface LlmClient {
  structured<T>(call: StructuredCall<T>): Promise<T>;
  research(call: ResearchCall): Promise<ResearchResult>;
}

export type UsageSink = (step: string, usage: UsageRecord, article?: string) => void;
