import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Config } from '../config.js';
import { worstCaseUsd, type CostLedger, type UsageRecord } from '../costs.js';
import { log } from '../log.js';
import type {
  CallBase,
  LlmClient,
  ResearchCall,
  ResearchResult,
  SeenSource,
  StructuredCall,
} from './client.js';

const MAX_PAUSE_CONTINUATIONS = 6;

function usageRecord(model: string, usage: Anthropic.Usage): UsageRecord {
  return {
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    webSearches: usage.server_tool_use?.web_search_requests ?? 0,
    webFetches: usage.server_tool_use?.web_fetch_requests ?? 0,
  };
}

/** Haiku 4.5 rejects `effort`; every newer model in config accepts it. */
function supportsEffort(model: string): boolean {
  return !model.startsWith('claude-haiku-4-5');
}

function cachedSystem(system: string): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function assertUsableStop(call: CallBase, message: Anthropic.Message): void {
  if (message.stop_reason === 'refusal') {
    throw new Error(`${call.step}: model refused (${JSON.stringify(message.stop_details ?? null)})`);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error(`${call.step}: output truncated at max_tokens=${call.maxTokens}`);
  }
}

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(
    private readonly config: Config,
    private readonly ledger: CostLedger,
  ) {
    // Retries 408/409/429/5xx and connection errors with backoff.
    this.client = new Anthropic({ maxRetries: 3, timeout: 20 * 60 * 1000 });
  }

  async structured<T>(call: StructuredCall<T>): Promise<T> {
    this.ledger.assertAffordable(
      worstCaseUsd(this.config, call.model, call.system.length + call.user.length, call.maxTokens),
      call.article,
    );
    const started = Date.now();
    const stream = this.client.messages.stream({
      model: call.model,
      max_tokens: call.maxTokens,
      system: cachedSystem(call.system),
      messages: [{ role: 'user', content: call.user }],
      output_config: {
        format: zodOutputFormat(call.schema),
        ...(supportsEffort(call.model) ? { effort: call.effort } : {}),
      },
    });
    const message = await stream.finalMessage();
    this.ledger.record(call.step, usageRecord(call.model, message.usage), call.article);
    log.info('llm_call', {
      step: call.step,
      model: call.model,
      stop: message.stop_reason,
      ms: Date.now() - started,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
    });
    assertUsableStop(call, message);

    let json: unknown;
    try {
      json = JSON.parse(textOf(message));
    } catch (error) {
      throw new Error(`${call.step}: response is not valid JSON (${String(error)})`);
    }
    const parsed = call.schema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`${call.step}: response does not match schema: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async research(call: ResearchCall): Promise<ResearchResult> {
    this.ledger.assertAffordable(this.config.research.worstCaseUsd, call.article);
    const tools: Anthropic.Messages.ToolUnion[] = [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: call.maxSearches,
        blocked_domains: call.blockedDomains,
        user_location: { type: 'approximate', country: 'LT', city: 'Vilnius', timezone: 'Europe/Vilnius' },
      },
      {
        type: 'web_fetch_20260209',
        name: 'web_fetch',
        max_uses: call.maxFetches,
        blocked_domains: call.blockedDomains,
        max_content_tokens: call.fetchMaxContentTokens,
      },
    ];

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: call.user }];
    const seen = new Map<string, SeenSource>();
    const notes: string[] = [];

    for (let turn = 0; turn <= MAX_PAUSE_CONTINUATIONS; turn += 1) {
      const stream = this.client.messages.stream({
        model: call.model,
        max_tokens: call.maxTokens,
        system: cachedSystem(call.system),
        messages,
        tools,
        output_config: { effort: call.effort },
      });
      const message = await stream.finalMessage();
      this.ledger.record(call.step, usageRecord(call.model, message.usage), call.article);

      for (const block of message.content) {
        if (block.type === 'text') notes.push(block.text);
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const result of block.content) {
            if (!seen.has(result.url)) {
              seen.set(result.url, { url: result.url, title: result.title, via: 'search', retrievedAt: null });
            }
          }
        }
        if (block.type === 'web_fetch_tool_result' && block.content.type === 'web_fetch_result') {
          seen.set(block.content.url, {
            url: block.content.url,
            title: block.content.content.title,
            via: 'fetch',
            retrievedAt: block.content.retrieved_at,
          });
        }
      }

      log.info('research_turn', { turn, stop: message.stop_reason, sources: seen.size });
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      if (message.stop_reason === 'refusal') {
        throw new Error(`${call.step}: model refused (${JSON.stringify(message.stop_details ?? null)})`);
      }
      break;
    }

    return { notes: notes.join('\n'), seen: [...seen.values()] };
  }
}
