import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AnthropicLlmClient } from '../src/llm/anthropic.js';
import { CostLedger } from '../src/costs.js';
import { config } from './helpers.js';

/** A fake SDK client whose `messages.stream` replays the given responses. */
function fakeClient(responses: Partial<Anthropic.Message>[]) {
  const calls: unknown[] = [];
  const client = {
    messages: {
      stream: (params: unknown) => {
        calls.push(params);
        const message = responses[Math.min(calls.length - 1, responses.length - 1)]!;
        return { finalMessage: async () => message };
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

const researchCall = {
  step: 'research',
  model: config.models.research,
  effort: 'high' as const,
  system: 'system',
  user: 'topic',
  maxTokens: 16_000,
  maxSearches: 12,
  maxFetches: 15,
  fetchMaxContentTokens: 20_000,
  blockedDomains: [],
  article: 'test-article',
};

// 1M input tokens on the research model: well above a tenth of the budget per turn.
const pausedTurn = (url: string): Partial<Anthropic.Message> => ({
  stop_reason: 'pause_turn',
  content: [
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url, title: 't', encrypted_content: 'x', page_age: null }] },
  ] as unknown as Anthropic.ContentBlock[],
  usage: { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 } } as unknown as Anthropic.Usage,
});

describe('research loop', () => {
  it('stops resuming pause_turn once the research budget is spent', async () => {
    const perTurn = (1_000_000 * config.pricing.models[config.models.research]!.input) / 1e6 + (3 * config.pricing.webSearchPer1000) / 1000;
    const turnsWithinBudget = Math.ceil(config.research.worstCaseUsd / perTurn);
    const { client, calls } = fakeClient([pausedTurn('https://a.lt/1'), pausedTurn('https://a.lt/2'), pausedTurn('https://a.lt/3'), pausedTurn('https://a.lt/4'), pausedTurn('https://a.lt/5'), pausedTurn('https://a.lt/6'), pausedTurn('https://a.lt/7')]);
    const ledger = new CostLedger(config, 'test', null, { persist: false });
    const result = await new AnthropicLlmClient(config, ledger, client).research(researchCall);
    expect(calls).toHaveLength(turnsWithinBudget);
    expect(calls.length).toBeLessThan(7); // without the budget it would resume up to 7 times
    expect(result.seen.map((source) => source.url)).toContain('https://a.lt/1');
  });

  it('resumes pause_turn until the model finishes when within budget', async () => {
    const cheap = (stop: 'pause_turn' | 'end_turn'): Partial<Anthropic.Message> => ({
      stop_reason: stop,
      content: [{ type: 'text', text: stop, citations: null }] as unknown as Anthropic.ContentBlock[],
      usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null } as unknown as Anthropic.Usage,
    });
    const { client, calls } = fakeClient([cheap('pause_turn'), cheap('pause_turn'), cheap('end_turn')]);
    const ledger = new CostLedger(config, 'test', null, { persist: false });
    const result = await new AnthropicLlmClient(config, ledger, client).research(researchCall);
    expect(calls).toHaveLength(3);
    expect(result.notes).toContain('end_turn');
  });
});
