import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkpoint, collectRatings, renderRatings, type PipelinePr } from '../src/ratings.js';
import { ROOT } from './helpers.js';

const pr = (number: number, comments: [string, string, string][]): PipelinePr => ({
  number,
  title: `Straipsnis ${number}`,
  url: `https://github.com/o/s/pull/${number}`,
  state: 'OPEN',
  comments: comments.map(([author, body, createdAt]) => ({ author, body, createdAt })),
});

describe('owner ratings of shadow PRs', () => {
  it('counts only the owner, and the latest rating wins', () => {
    const [rating] = collectRatings(
      [
        pr(1, [
          ['mykolas268-jpg', '/ivertinimas 3 per ilgas įvadas', '2026-10-01T10:00:00Z'],
          ['stranger', '/ivertinimas 1', '2026-10-01T11:00:00Z'],
          ['Mykolas268-JPG', 'Pataisyta.\n/ivertinimas 5/5 dabar gerai', '2026-10-02T10:00:00Z'],
        ]),
      ],
      'mykolas268-jpg',
    );
    expect(rating).toMatchObject({ rating: 5, notes: 'dabar gerai', ratedAt: '2026-10-02T10:00:00Z' });
  });

  it('keeps every factual error the owner reports', () => {
    const [rating] = collectRatings(
      [pr(2, [['owner', '/ivertinimas 4\n/klaida Kaina ne 20 USD, o 25 USD', '2026-10-01T10:00:00Z'], ['owner', '/klaida Neteisinga data', '2026-10-01T12:00:00Z'], ['stranger', '/klaida spam', '2026-10-01T13:00:00Z']])],
      'owner',
    );
    expect(rating!.factualErrors).toEqual(['Kaina ne 20 USD, o 25 USD', 'Neteisinga data']);
  });

  it('ignores ratings outside 1–5 and text that only mentions the command', () => {
    const [rating] = collectRatings([pr(3, [['owner', 'Parašyk /ivertinimas 4 vėliau\n/ivertinimas 6\n/ivertinimas 45', '2026-10-01T10:00:00Z']])], 'owner');
    expect(rating!.rating).toBeNull();
  });

  it('reaches the Phase 2 checkpoint at five articles rated ≥ 4 without factual errors', () => {
    const good = (n: number) => pr(n, [['owner', '/ivertinimas 4', '2026-10-01T10:00:00Z']]);
    const withError = pr(9, [['owner', '/ivertinimas 5\n/klaida x', '2026-10-01T10:00:00Z']]);
    expect(checkpoint(collectRatings([good(1), good(2), good(3), good(4), withError], 'owner'))).toMatchObject({ rated: 5, good: 4, reached: false });
    expect(checkpoint(collectRatings([good(1), good(2), good(3), good(4), good(5)], 'owner')).reached).toBe(true);
    expect(renderRatings(collectRatings([withError], 'owner'), checkpoint([]))).toMatch(/\| \[#9\]\(https:\/\/github.com\/o\/s\/pull\/9\) \| Straipsnis 9 \| 5 \| x \|/);
  });
});

describe('ratings command', () => {
  it('writes state and announces the checkpoint only the first time', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratings-'));
    const prs = [1, 2, 3, 4, 5].map((number) => ({
      number, title: `S${number}`, url: `https://github.com/o/s/pull/${number}`, state: 'OPEN',
      comments: [{ author: { login: 'owner' }, body: '/ivertinimas 4', createdAt: '2026-10-01T10:00:00Z' }],
    }));
    fs.writeFileSync(path.join(dir, 'prs.json'), JSON.stringify(prs));
    const run = () =>
      spawnSync('npx', ['tsx', path.join(ROOT, 'src/cli.ts'), 'ratings', '--prs', path.join(dir, 'prs.json'), '--owner', 'owner', '--state', path.join(dir, 'state')], {
        encoding: 'utf8',
        env: { ...process.env, TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', PIPELINE_PAUSED: '' },
      });
    const first = run();
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/2 etapo tikslas pasiektas/);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'state', 'ratings.json'), 'utf8')).checkpoint).toMatchObject({ good: 5, reached: true });
    expect(run().stdout).not.toMatch(/2 etapo tikslas pasiektas/);
  }, 60_000);
});
