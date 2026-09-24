import { gateResult, type GateResult } from './types.js';

/**
 * Checks that every outbound URL resolves. 403/429 count as warnings: many
 * sites block non-browser clients while the page itself is fine.
 */

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

async function status(url: string, fetcher: Fetcher): Promise<number | string> {
  const init = (method: 'HEAD' | 'GET'): RequestInit => ({
    method,
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': 'verslas.ai link checker (+https://www.verslas.ai)' },
  });
  try {
    const head = await fetcher(url, init('HEAD'));
    if (head.status !== 405 && head.status !== 403 && head.status !== 400) return head.status;
    const get = await fetcher(url, init('GET'));
    return get.status;
  } catch (error) {
    return error instanceof Error ? error.name : 'error';
  }
}

export async function checkLinksResolve(urls: string[], fetcher: Fetcher = fetch): Promise<GateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unique = [...new Set(urls)];
  const results = await Promise.all(unique.map(async (url) => [url, await status(url, fetcher)] as const));
  for (const [url, code] of results) {
    if (typeof code === 'number' && code >= 200 && code < 400) continue;
    if (code === 403 || code === 429) warnings.push(`Nuoroda ${url} grąžino ${code} (tikriausiai blokuoja robotus).`);
    else errors.push(`Neveikianti nuoroda ${url}: ${code}`);
  }
  return gateResult('links-resolve', errors, warnings);
}
