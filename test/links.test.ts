import { describe, expect, it } from 'vitest';
import { checkLinksResolve, type Fetcher } from '../src/gates/links.js';

/** Fake fetcher: each URL maps to a list of answers consumed in order (last one repeats). */
function fakeFetcher(answers: Record<string, (number | Error)[]>): { fetcher: Fetcher; calls: string[] } {
  const calls: string[] = [];
  const used = new Map<string, number>();
  const fetcher: Fetcher = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    const list = answers[url] ?? [200];
    const index = used.get(url) ?? 0;
    used.set(url, index + 1);
    const answer = list[Math.min(index, list.length - 1)]!;
    if (answer instanceof Error) throw answer;
    return new Response(null, { status: answer });
  };
  return { fetcher, calls };
}

const dnsError = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });

describe('links-resolve gate', () => {
  it('passes working links and falls back to GET when HEAD is refused', async () => {
    const { fetcher } = fakeFetcher({ 'https://a.lt/ok': [200], 'https://a.lt/head-404': [404, 200] });
    const result = await checkLinksResolve(['https://a.lt/ok', 'https://a.lt/head-404'], fetcher);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('fails dead links: 404 on HEAD and GET, or a host that does not exist', async () => {
    const { fetcher } = fakeFetcher({ 'https://a.lt/gone': [404], 'https://nera.example/x': [dnsError] });
    const result = await checkLinksResolve(['https://a.lt/gone', 'https://nera.example/x'], fetcher);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join()).toMatch(/404/);
    expect(result.errors.join()).toMatch(/ENOTFOUND/);
  });

  it('retries transient failures once and only warns if they persist', async () => {
    const { fetcher, calls } = fakeFetcher({
      'https://a.lt/flaky': [503, 503, 200],
      'https://a.lt/slow': [timeout],
      'https://a.lt/bot-wall': [403],
    });
    const result = await checkLinksResolve(['https://a.lt/flaky', 'https://a.lt/slow', 'https://a.lt/bot-wall'], fetcher);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(2); // slow + bot-wall; flaky recovered on retry
    expect(calls.filter((call) => call.endsWith('/flaky')).length).toBe(3);
  });
});
