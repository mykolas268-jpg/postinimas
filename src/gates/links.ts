import { gateResult, type GateResult } from './types.js';

/**
 * Checks that every outbound URL resolves. Only a definite answer fails the
 * gate: a 4xx (except 403/429, which many sites send to non-browser clients)
 * or a host that does not exist. Timeouts, 5xx and dropped connections are
 * retried once and then only warned about — the writer cannot fix a flaky
 * server in a revision, and every URL was retrieved during research.
 */

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

type Outcome = { kind: 'ok' } | { kind: 'dead'; detail: string } | { kind: 'transient'; detail: string };

function request(method: 'HEAD' | 'GET'): RequestInit {
  return {
    method,
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': 'verslas.ai link checker (+https://www.verslas.ai)' },
  };
}

function classify(status: number): Outcome {
  if (status >= 200 && status < 400) return { kind: 'ok' };
  if (status === 403 || status === 429 || status >= 500) return { kind: 'transient', detail: String(status) };
  return { kind: 'dead', detail: String(status) };
}

/** DNS failure means the host is gone; anything else thrown is treated as transient. */
function classifyError(error: unknown): Outcome {
  const cause = (error as { cause?: { code?: string } } | null)?.cause?.code;
  if (cause === 'ENOTFOUND') return { kind: 'dead', detail: 'ENOTFOUND' };
  return { kind: 'transient', detail: cause ?? (error instanceof Error ? error.name : 'error') };
}

async function probe(url: string, fetcher: Fetcher): Promise<Outcome> {
  try {
    const head = classify((await fetcher(url, request('HEAD'))).status);
    if (head.kind === 'ok') return head;
    // Some servers answer HEAD with 4xx/5xx while GET works.
    return classify((await fetcher(url, request('GET'))).status);
  } catch (error) {
    return classifyError(error);
  }
}

export async function checkLinksResolve(urls: string[], fetcher: Fetcher = fetch): Promise<GateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unique = [...new Set(urls)];
  const results = await Promise.all(
    unique.map(async (url) => {
      const first = await probe(url, fetcher);
      return [url, first.kind === 'transient' ? await probe(url, fetcher) : first] as const;
    }),
  );
  for (const [url, outcome] of results) {
    if (outcome.kind === 'dead') errors.push(`Neveikianti nuoroda ${url}: ${outcome.detail}`);
    else if (outcome.kind === 'transient') {
      warnings.push(`Nuoroda ${url} neatsakė patikimai (${outcome.detail}) — patikrink ranka.`);
    }
  }
  return gateResult('links-resolve', errors, warnings);
}
