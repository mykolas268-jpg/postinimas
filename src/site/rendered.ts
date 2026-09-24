import { createProcessor } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';

/**
 * What the site will actually render as a link or an image. The body is parsed
 * with the same MDX parser and plugins as the site (components/mdx-content.tsx
 * and scripts/check-content.mjs in mykolas268-jpg/verslas), so GFM autolinks
 * ("https://…", "www.…", e-mail addresses), reference links and JSX
 * attributes are all seen — a regex over "[text](url)" misses them.
 */

export interface RenderedTarget {
  kind: 'link' | 'image' | 'definition' | 'jsx';
  url: string;
}

interface Node {
  type: string;
  url?: string;
  name?: string | null;
  attributes?: { type: string; name?: string; value?: unknown }[];
  children?: Node[];
}

const processor = createProcessor({ remarkPlugins: [remarkGfm] });

/** Throws when the body is not valid MDX (the caller fails closed). */
export function renderedTargets(mdx: string): RenderedTarget[] {
  const targets: RenderedTarget[] = [];
  const visit = (node: Node): void => {
    if ((node.type === 'link' || node.type === 'image' || node.type === 'definition') && typeof node.url === 'string') {
      targets.push({ kind: node.type, url: node.url });
    }
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      for (const attribute of node.attributes ?? []) {
        if (attribute.type === 'mdxJsxAttribute' && /^(src|href)$/i.test(attribute.name ?? '') && typeof attribute.value === 'string') {
          targets.push({ kind: node.name === 'ProseImage' || /^src$/i.test(attribute.name ?? '') ? 'image' : 'jsx', url: attribute.value });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(processor.parse(mdx) as unknown as Node);
  return targets;
}
