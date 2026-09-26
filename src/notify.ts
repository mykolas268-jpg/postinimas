import { log } from './log.js';

/**
 * Owner notifications (Telegram, Lithuanian). Plain text only — no
 * parse_mode — so titles and reasons that come from model output cannot inject
 * markup. Sending is best-effort: a failed notification never fails a run, but
 * it is logged as a warning. Without TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID the
 * message is only printed.
 */

export interface CostAlert {
  fraction: number;
  monthToDate: number;
  cap: number;
}

export type NotifyEvent =
  | {
      kind: 'article';
      status: 'ready' | 'failed' | 'aborted' | 'error';
      topic: string;
      title?: string;
      reason?: string;
      attempts?: number;
      costUsd?: number;
      /** Result of the site's strict check + build ('success', 'failure', 'skipped', …). */
      verify?: string;
      prUrl?: string;
      /** Why no PR was opened although the article is ready. */
      noPrReason?: 'dry-run' | 'backpressure' | 'publish-failed';
      costAlerts?: CostAlert[];
      runUrl: string;
    }
  | {
      kind: 'eval';
      round: string;
      ready: number;
      topics: number;
      passRate: number;
      costUsd: number;
      reportUrl?: string;
      costAlerts?: CostAlert[];
      runUrl: string;
    };

const TELEGRAM_MAX = 4096;
const usd = (value: number) => `${value.toFixed(2)} USD`;
const pct = (value: number) => `${Math.round(value * 100)} %`;

function alertLines(alerts: CostAlert[] = []): string[] {
  return alerts.map(
    (alert) => `Dėmesio: išleista ${pct(alert.monthToDate / alert.cap)} mėnesio biudžeto (${usd(alert.monthToDate)} iš ${alert.cap} USD).`,
  );
}

export function formatNotification(event: NotifyEvent): string {
  const lines: string[] = [];
  if (event.kind === 'eval') {
    const target = event.passRate >= 0.7 ? 'tikslas (≥ 70 %) pasiektas' : 'tikslas ≥ 70 % dar nepasiektas';
    lines.push(
      `Kokybės vertinimas, raundas ${event.round}: praėjo ${event.ready} iš ${event.topics} (${pct(event.passRate)}) — ${target}.`,
      `Kaina: ${usd(event.costUsd)}.`,
      ...(event.reportUrl ? [`Ataskaita: ${event.reportUrl}`] : []),
    );
  } else {
    const name = event.title ? `„${event.title}“` : `tema „${event.topic}“`;
    switch (event.status) {
      case 'ready':
        if (event.verify && event.verify !== 'success') {
          lines.push(`Straipsnis ${name} paruoštas, bet svetainės patikra nepavyko — PR neatidarytas.`);
        } else if (event.prUrl) {
          lines.push(`Naujas bandomasis straipsnis ${name}.`, `PR: ${event.prUrl}`, 'Įvertink jį PR komentaru /ivertinimas 1–5 ir pastabomis; faktų klaidas pažymėk /klaida.');
        } else if (event.noPrReason === 'backpressure') {
          lines.push(`Straipsnis ${name} paruoštas, bet PR neatidarytas: laukia per daug neperžiūrėtų PR.`);
        } else if (event.noPrReason === 'dry-run') {
          lines.push(`Bandomasis paleidimas (be PR): straipsnis ${name} praėjo visus vartus.`);
        } else {
          lines.push(`Straipsnis ${name} paruoštas, bet PR atidaryti nepavyko.`);
        }
        break;
      case 'failed':
        lines.push(`Straipsnis ${name} nepraėjo kokybės vartų${event.attempts ? ` po ${event.attempts} bandymų` : ''} — nepublikuojamas.`);
        break;
      case 'aborted':
        lines.push(`Straipsnis ${name} sustabdytas: ${event.reason ?? 'priežastis nenurodyta'}.`);
        break;
      case 'error':
        lines.push(`Paleidimas nepavyko dėl klaidos (${name}): ${event.reason ?? 'žr. žurnalą'}.`);
        break;
    }
    if (event.costUsd !== undefined) lines.push(`Kaina: ${usd(event.costUsd)}.`);
  }
  lines.push(...alertLines(event.costAlerts), `Paleidimas: ${event.runUrl}`);
  const text = lines.join('\n');
  return text.length > TELEGRAM_MAX ? `${text.slice(0, TELEGRAM_MAX - 1)}…` : text;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface TelegramConfig {
  token: string | undefined;
  chatId: string | undefined;
  fetcher?: Fetcher;
}

/** Sends one plain-text message; retries once on 429/5xx or a network error. */
export async function sendTelegram(text: string, config: TelegramConfig): Promise<'sent' | 'skipped' | 'failed'> {
  const token = config.token?.trim();
  const chatId = config.chatId?.trim();
  if (!token || !chatId) return 'skipped';
  const fetcher = config.fetcher ?? fetch;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return 'sent';
      // Never log the URL: it contains the bot token.
      log.warn('telegram_failed', { attempt, status: response.status });
      if (response.status !== 429 && response.status < 500) return 'failed';
    } catch (error) {
      log.warn('telegram_failed', { attempt, error: error instanceof Error ? error.name : 'error' });
    }
  }
  return 'failed';
}
