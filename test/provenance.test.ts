import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkOutboundLinks, normalizeUrl, sanitizeFactSheet, siteDomain } from '../src/gates/provenance.js';
import { FactSheetSchema } from '../src/schemas.js';
import { fixtures } from './helpers.js';

const factSheet = FactSheetSchema.parse(
  JSON.parse(fs.readFileSync(path.join(fixtures, 'article', 'factsheet.json'), 'utf8')),
);
const seen = JSON.parse(fs.readFileSync(path.join(fixtures, 'article', 'research.json'), 'utf8')).seen;

describe('provenance', () => {
  it('normalises URLs and domains', () => {
    expect(normalizeUrl('https://www.example.com/a/?utm_source=x#top')).toBe('https://example.com/a');
    // Same page written differently by the research and the fact-sheet step
    for (const [a, b] of [
      ['https://eur-lex.europa.eu/legal-content/LT/TXT/?uri=CELEX:32024R1689', 'https://eur-lex.europa.eu/legal-content/LT/TXT/?uri=CELEX%3A32024R1689'],
      ['https://www.inovacijuagentura.lt/priemonės/', 'https://inovacijuagentura.lt/priemon%C4%97s'],
      ['http://example.lt/a', 'https://example.lt/a'],
      ['https://example.lt/a/?x=1&y=2', 'https://example.lt/a?y=2&x=1'],
    ]) {
      expect(normalizeUrl(a!)).toBe(normalizeUrl(b!));
    }
    expect(normalizeUrl('https://example.lt/a?x=1')).not.toBe(normalizeUrl('https://example.lt/a?x=2'));
    expect(siteDomain('https://vdai.lrv.lt/lt/x')).toBe('lrv.lt');
    expect(siteDomain('https://news.bbc.co.uk/x')).toBe('bbc.co.uk');
  });

  it('drops sources the research never retrieved and demotes the claim', () => {
    const result = sanitizeFactSheet(factSheet, seen);
    expect(result.droppedSources).toContain('https://invented.example.net/rumour');
    expect(result.factSheet.claims.map((claim) => claim.id)).not.toContain('C8');
    expect(result.factSheet.unknowns.some((unknown) => unknown.includes('C8'))).toBe(true);
  });

  it('demotes a claim with a single secondary source', () => {
    const weak = {
      ...factSheet,
      claims: [
        {
          ...factSheet.claims[0]!,
          id: 'X1',
          sources: [{ ...factSheet.claims[0]!.sources[0]!, url: 'https://news.example.org/examplevideo-review', tier: 'secondary' as const }],
        },
      ],
    };
    expect(sanitizeFactSheet(weak, seen).factSheet.claims).toHaveLength(0);
  });

  it('rejects outbound links that are not in the fact sheet', () => {
    const clean = sanitizeFactSheet(factSheet, seen).factSheet;
    const result = checkOutboundLinks('Žr. [čia](https://evil.example.com/x).', ['https://example.com/pricing'], clean);
    expect(result.passed).toBe(false);
    expect(result.errors[0]).toMatch(/evil/);
  });
});
