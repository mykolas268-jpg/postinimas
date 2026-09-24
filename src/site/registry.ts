import fs from 'node:fs';
import path from 'node:path';
import { CORE_SCHEMA, load } from 'js-yaml';

/**
 * Article registry, rebuilt from the site repo on every run. The repo is the
 * source of truth: the admin panel can publish articles the pipeline never
 * saw, and articles can be edited or deleted by hand.
 */

export interface RegistryEntry {
  slug: string;
  title: string;
  excerpt: string;
  tags: string[];
  date: string;
  updated: string | null;
  type: string;
  cluster: string | null;
  draft: boolean;
  file: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function readFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const match = raw.replace(/^﻿/, '').match(FRONTMATTER_RE);
  if (!match) return { data: {}, body: raw };
  const data = (load(match[1] ?? '', { schema: CORE_SCHEMA }) ?? {}) as Record<string, unknown>;
  return { data, body: raw.slice(match[0].length) };
}

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

export function loadRegistry(siteDir: string, contentDir: string): RegistryEntry[] {
  const dir = path.join(siteDir, contentDir);
  if (!fs.existsSync(dir)) {
    throw new Error(`Site content directory not found: ${dir} (is --site pointing at the verslas checkout?)`);
  }
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.mdx') || file.endsWith('.md'))
    .map((file) => {
      const { data } = readFrontmatter(fs.readFileSync(path.join(dir, file), 'utf8'));
      return {
        slug: str(data.slug, file.replace(/\.mdx?$/, '')),
        title: str(data.title),
        excerpt: str(data.excerpt),
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        date: str(data.date),
        updated: typeof data.updated === 'string' ? data.updated : null,
        type: str(data.type, 'guide'),
        cluster: typeof data.cluster === 'string' ? data.cluster : null,
        draft: data.draft === true,
        file: path.join(contentDir, file),
      };
    })
    .filter((entry) => !entry.draft)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Lowercase word stems (first 5 letters) for rough Lithuanian matching. */
export function stems(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/\p{L}{3,}/gu) ?? []).map((word) => word.slice(0, 5)),
  );
}

/** Jaccard overlap of stems — a cheap cannibalisation signal. */
export function overlap(a: string, b: string): number {
  const left = stems(a);
  const right = stems(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const stem of left) if (right.has(stem)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export function mostSimilar(
  registry: RegistryEntry[],
  text: string,
): { entry: RegistryEntry; score: number } | null {
  let best: { entry: RegistryEntry; score: number } | null = null;
  for (const entry of registry) {
    const score = overlap(text, `${entry.title} ${entry.excerpt} ${entry.tags.join(' ')}`);
    if (!best || score > best.score) best = { entry, score };
  }
  return best;
}
