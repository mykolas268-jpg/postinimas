/**
 * Small, deliberately conservative MDX text utilities for the gates. The
 * site's own `check:content --strict` does the authoritative MDX parse in the
 * verify job; these helpers only need to be good enough to find problems early.
 */

export interface Heading {
  level: number;
  text: string;
  line: number;
}

/** Removes fenced code blocks, keeping line count stable. */
export function withoutCodeBlocks(mdx: string): string {
  return mdx.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (block) => block.replace(/[^\n]/g, ''));
}

export function headings(mdx: string): Heading[] {
  const result: Heading[] = [];
  withoutCodeBlocks(mdx)
    .split('\n')
    .forEach((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (match) result.push({ level: match[1]!.length, text: match[2]!, line: index + 1 });
    });
  return result;
}

export interface MdLink {
  text: string;
  url: string;
}

export function markdownLinks(mdx: string): MdLink[] {
  const body = withoutCodeBlocks(mdx).replace(/`[^`\n]*`/g, '');
  return [...body.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .filter((match) => match[1] !== '!')
    .map((match) => ({ text: match[2] ?? '', url: match[3] ?? '' }));
}

export function markdownImages(mdx: string): { alt: string; url: string }[] {
  return [...withoutCodeBlocks(mdx).matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].map((match) => ({
    alt: match[1] ?? '',
    url: match[2] ?? '',
  }));
}

/**
 * Plain prose: no code, no inline code, no JSX tags (their inner text stays),
 * link targets dropped (link text stays), heading/list markers removed.
 */
export function prose(mdx: string): string {
  return withoutCodeBlocks(mdx)
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<\/?[A-Z][A-Za-z]*(?:\s[^>]*)?\/?>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*\|/gm, ' ')
    .replace(/\*\*|__|\*|_/g, '');
}

/** Removes „…“ quotations (quoted text is exempt from style rules). */
export function withoutQuotations(text: string): string {
  return text.replace(/„[^“\n]*“/g, ' ');
}

export function words(text: string): string[] {
  return text.match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? [];
}

export function wordCount(mdx: string): number {
  return words(prose(mdx)).length;
}

/** Splits prose into sentences (good enough for Lithuanian and English). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[„"(\p{Lu}\d])|\n{2,}/u)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** First ~N words of the body prose (the intro). */
export function firstWords(mdx: string, count: number): string {
  return words(prose(mdx)).slice(0, count).join(' ');
}

/** Rough stems for Lithuanian keyword matching (inflection-tolerant). */
export function keywordStems(phrase: string): string[] {
  return (phrase.toLowerCase().match(/\p{L}{3,}/gu) ?? [])
    .filter((word) => !STOP.has(word))
    .map((word) => word.slice(0, Math.max(4, Math.min(6, word.length - 2))));
}

const STOP = new Set(['kaip', 'kas', 'kad', 'kur', 'kiek', 'arba', 'ir', 'su', 'per', 'apie', 'the', 'and', 'for']);

export function containsStems(text: string, stems: string[]): boolean {
  const lower = text.toLowerCase();
  return stems.every((stem) => lower.includes(stem));
}

export const EXAMPLE_MARKERS = /(pavyzd|pvz\.|tarkime|įsivaizduok|sakykime|iliustr|hipotetin)/i;
