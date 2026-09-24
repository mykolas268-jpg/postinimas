import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CostLedger } from '../src/costs.js';
import { formatNotification, sendTelegram, type Fetcher } from '../src/notify.js';
import { ROOT, config } from './helpers.js';

const runUrl = 'https://github.com/o/r/actions/runs/1';

describe('owner notifications (Lithuanian)', () => {
  it.each([
    [{ status: 'ready', title: 'DI turinio žymėjimas', prUrl: 'https://github.com/o/s/pull/7', costUsd: 3.2 }, /Naujas bandomasis straipsnis „DI turinio žymėjimas“.*PR: https:\/\/github.com\/o\/s\/pull\/7.*\/ivertinimas.*Kaina: 3.20 USD/s],
    [{ status: 'ready', title: 'A', verify: 'failure' }, /svetainės patikra nepavyko — PR neatidarytas/],
    [{ status: 'ready', title: 'A', noPrReason: 'backpressure' }, /per daug neperžiūrėtų PR/],
    [{ status: 'ready', title: 'A', noPrReason: 'dry-run' }, /Bandomasis paleidimas \(be PR\)/],
    [{ status: 'failed', title: 'A', attempts: 3 }, /nepraėjo kokybės vartų po 3 bandymų/],
    [{ status: 'aborted', reason: 'Patvirtintų faktų: 2 (reikia bent 5)' }, /tema „T“ sustabdytas: Patvirtintų faktų: 2/],
    [{ status: 'error', reason: 'auth' }, /nepavyko dėl klaidos .*auth/],
  ] as const)('%o', (fields, pattern) => {
    const text = formatNotification({ kind: 'article', topic: 'T', runUrl, ...fields });
    expect(text).toMatch(pattern);
    expect(text).toContain(`Paleidimas: ${runUrl}`);
  });

  it('reports eval rounds against the 70 % target and cost alerts', () => {
    const text = formatNotification({
      kind: 'eval', round: '2', ready: 5, topics: 6, passRate: 5 / 6, costUsd: 31.4, runUrl,
      costAlerts: [{ fraction: 0.5, monthToDate: 80, cap: 150 }],
    });
    expect(text).toMatch(/raundas 2: praėjo 5 iš 6 \(83 %\) — tikslas \(≥ 70 %\) pasiektas/);
    expect(text).toMatch(/išleista 53 % mėnesio biudžeto \(80.00 USD iš 150 USD\)/);
  });

  it('stays within the Telegram message limit', () => {
    const text = formatNotification({ kind: 'article', status: 'error', topic: 'T', reason: 'x'.repeat(10_000), runUrl });
    expect(text.length).toBeLessThanOrEqual(4096);
  });
});

describe('Telegram delivery', () => {
  const recorder = (statuses: (number | Error)[]) => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const answer = statuses[Math.min(calls.length - 1, statuses.length - 1)]!;
      if (answer instanceof Error) throw answer;
      return new Response('{}', { status: answer });
    };
    return { calls, fetcher };
  };

  it('is skipped without a token or chat id', async () => {
    expect(await sendTelegram('x', { token: undefined, chatId: '1' })).toBe('skipped');
    expect(await sendTelegram('x', { token: 't', chatId: ' ' })).toBe('skipped');
  });

  it('sends plain text (no parse_mode) to the configured chat', async () => {
    const { calls, fetcher } = recorder([200]);
    expect(await sendTelegram('Labas', { token: 'TOKEN', chatId: '42', fetcher })).toBe('sent');
    expect(calls[0]!.body).toEqual({ chat_id: '42', text: 'Labas', disable_web_page_preview: true });
    expect(calls[0]!.url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
  });

  it('retries once on 5xx or a network error, not on 4xx', async () => {
    expect(await sendTelegram('x', { token: 't', chatId: '1', fetcher: recorder([502, 200]).fetcher })).toBe('sent');
    expect(await sendTelegram('x', { token: 't', chatId: '1', fetcher: recorder([new TypeError('fetch failed'), 200]).fetcher })).toBe('sent');
    const bad = recorder([400, 200]);
    expect(await sendTelegram('x', { token: 't', chatId: '1', fetcher: bad.fetcher })).toBe('failed');
    expect(bad.calls).toHaveLength(1);
  });
});

describe('cost alerts', () => {
  it('records the monthly-cap thresholds a run crosses', () => {
    const ledger = new CostLedger(config, 'test', null, { persist: false });
    const perMillion = config.pricing.models[config.models.writer]!.output;
    const halfCapTokens = Math.ceil(((config.caps.monthlyUsd * 0.5) / perMillion) * 1e6);
    ledger.record('write', { model: config.models.writer, inputTokens: 0, outputTokens: halfCapTokens, cacheWriteTokens: 0, cacheReadTokens: 0, webSearches: 0, webFetches: 0 });
    expect(ledger.costAlerts.map((alert) => alert.fraction)).toEqual([0.5]);
  });
});

describe('notify command', () => {
  it('builds the message from a run directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-'));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ topic: 'T', exitCode: 3, costUsd: 4.5, costAlerts: [] }));
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ status: 'failed', title: 'Antraštė', attempts: 3, costUsd: 4.5 }));
    const run = spawnSync('npx', ['tsx', path.join(ROOT, 'src/cli.ts'), 'notify', '--kind', 'article', '--dir', dir], {
      encoding: 'utf8',
      env: { ...process.env, TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', PIPELINE_PAUSED: '' },
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/Straipsnis „Antraštė“ nepraėjo kokybės vartų po 3 bandymų/);
    expect(run.stdout).toMatch(/Telegram not configured/);
  }, 30_000);
});
