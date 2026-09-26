/**
 * The owner's ratings of shadow PRs — the Phase 2 checkpoint is "5 shadow
 * articles pass every gate; the owner rates them ≥ 4/5 with zero factual
 * errors". The owner comments on a pipeline PR:
 *
 *   /ivertinimas 4 gera struktūra, per ilgas įvadas
 *   /klaida Kaina ne 20 USD, o 25 USD
 *
 * Only the owner's comments count (anyone can comment on a PR; that text is
 * untrusted). The latest rating wins; every /klaida line is kept.
 */

export interface PrComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface PipelinePr {
  number: number;
  title: string;
  url: string;
  state: string;
  comments: PrComment[];
}

export interface PrRating {
  number: number;
  title: string;
  url: string;
  rating: number | null;
  notes: string;
  factualErrors: string[];
  ratedAt: string | null;
}

export interface Checkpoint {
  needed: number;
  rated: number;
  good: number;
  reached: boolean;
}

const RATING = /^\/ivertinimas[ \t]+([1-5])(?:[ \t]*\/[ \t]*5)?(?![\d])[ \t]*(.*)$/gim;
const FACTUAL_ERROR = /^\/klaida[ \t]+(.+)$/gim;

export function collectRatings(prs: PipelinePr[], owner: string): PrRating[] {
  const isOwner = (author: string) => author.toLowerCase() === owner.toLowerCase();
  return prs
    .map((pr) => {
      const comments = pr.comments
        .filter((comment) => isOwner(comment.author))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      let rating: number | null = null;
      let notes = '';
      let ratedAt: string | null = null;
      const factualErrors: string[] = [];
      for (const comment of comments) {
        for (const match of comment.body.matchAll(RATING)) {
          rating = Number(match[1]);
          notes = (match[2] ?? '').trim().slice(0, 500);
          ratedAt = comment.createdAt;
        }
        for (const match of comment.body.matchAll(FACTUAL_ERROR)) factualErrors.push((match[1] ?? '').trim().slice(0, 500));
      }
      return { number: pr.number, title: pr.title, url: pr.url, rating, notes, factualErrors, ratedAt };
    })
    .sort((a, b) => a.number - b.number);
}

export function checkpoint(ratings: PrRating[], needed = 5): Checkpoint {
  const rated = ratings.filter((item) => item.rating !== null).length;
  const good = ratings.filter((item) => (item.rating ?? 0) >= 4 && item.factualErrors.length === 0).length;
  return { needed, rated, good, reached: good >= needed };
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderRatings(ratings: PrRating[], status: Checkpoint): string {
  const lines = [
    '# Bandomųjų straipsnių įvertinimai',
    '',
    `2 etapo tikslas: ${status.needed} straipsniai, įvertinti ≥ 4/5 ir be faktų klaidų. Dabar: **${status.good}** (įvertinta: ${status.rated}).`,
    status.reached ? '**Tikslas pasiektas.**' : '',
    '',
    '| PR | Straipsnis | Įvertinimas | Faktų klaidos | Pastabos |',
    '|---|---|---|---|---|',
    ...ratings.map(
      (item) =>
        `| [#${item.number}](${item.url}) | ${cell(item.title)} | ${item.rating ?? '—'} | ${item.factualErrors.length ? cell(item.factualErrors.join('; ')) : '—'} | ${cell(item.notes) || '—'} |`,
    ),
    '',
  ];
  return lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n');
}
