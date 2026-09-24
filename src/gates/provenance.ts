import type { SeenSource } from '../llm/client.js';
import type { Claim, FactSheet } from '../schemas.js';
import { gateResult, type GateResult } from './types.js';
import { markdownLinks } from './text.js';

/**
 * Source provenance. A fact-sheet URL is trusted only if it appeared in a
 * web_search or web_fetch result during this run — a model cannot cite a URL
 * it invented. Claims need a primary source or two independent domains.
 */

/** Comparison key for URLs — never written to the article (sources keep their original URL). */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = '';
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_|^(fbclid|gclid|ref)$/i.test(key)) parsed.searchParams.delete(key);
    }
    // Re-serialising the query makes "?uri=CELEX:32024R1689" and "?uri=CELEX%3A32024R1689" equal.
    parsed.searchParams.sort();
    parsed.hostname = parsed.hostname.replace(/^www\./, '');
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    const text = parsed.toString();
    return text.endsWith('/') ? text.slice(0, -1) : text;
  } catch {
    return url.trim();
  }
}

/** Registrable-ish domain: last two labels (three for known 2nd-level suffixes). */
export function siteDomain(url: string): string {
  try {
    const labels = new URL(url).hostname.replace(/^www\./, '').split('.');
    const twoLevel = /^(co|com|org|gov|ac|net)\.[a-z]{2}$/.test(labels.slice(-2).join('.'));
    return labels.slice(twoLevel ? -3 : -2).join('.');
  } catch {
    return url;
  }
}

export interface SanitizedFactSheet {
  factSheet: FactSheet;
  droppedSources: string[];
  demotedClaims: { id: string; claim: string; reason: string }[];
}

function isVerified(claim: Claim): boolean {
  if (claim.sources.some((source) => source.tier === 'primary')) return true;
  return new Set(claim.sources.map((source) => siteDomain(source.url))).size >= 2;
}

/**
 * Removes sources that were never retrieved; claims left without enough
 * evidence move to `unknowns` so the writer cannot use them.
 */
export function sanitizeFactSheet(factSheet: FactSheet, seen: SeenSource[]): SanitizedFactSheet {
  const seenUrls = new Set(seen.map((source) => normalizeUrl(source.url)));
  const droppedSources: string[] = [];
  const demotedClaims: SanitizedFactSheet['demotedClaims'] = [];
  const claims: Claim[] = [];
  const unknowns = [...factSheet.unknowns];

  for (const claim of factSheet.claims) {
    const sources = claim.sources.filter((source) => {
      const ok = seenUrls.has(normalizeUrl(source.url));
      if (!ok) droppedSources.push(source.url);
      return ok;
    });
    const cleaned: Claim = { ...claim, sources, verifiedByPrimary: sources.some((s) => s.tier === 'primary') };
    if (sources.length === 0) {
      demotedClaims.push({ id: claim.id, claim: claim.claim, reason: 'no retrieved source' });
      unknowns.push(`UNVERIFIED (${claim.id}): ${claim.claim}`);
    } else if (!isVerified(cleaned)) {
      demotedClaims.push({ id: claim.id, claim: claim.claim, reason: 'needs a primary source or 2 independent domains' });
      unknowns.push(`UNVERIFIED (${claim.id}): ${claim.claim}`);
    } else {
      claims.push(cleaned);
    }
  }

  return { factSheet: { ...factSheet, claims, unknowns }, droppedSources, demotedClaims };
}

const DEMOTION_LT: Record<string, string> = {
  'no retrieved source': 'nė vienas šaltinis nebuvo atsisiųstas',
  'needs a primary source or 2 independent domains': 'reikia pirminio šaltinio arba 2 nepriklausomų domenų',
};

export function checkProvenance(sanitized: SanitizedFactSheet, minClaims = 5): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (sanitized.factSheet.claims.length < minClaims) {
    errors.push(
      `Patvirtintų faktų: ${sanitized.factSheet.claims.length} (reikia bent ${minClaims}) — straipsniui rašyti per mažai.`,
    );
  }
  for (const url of new Set(sanitized.droppedSources)) {
    warnings.push(`Pašalintas šaltinis, kurio tyrimas neatsisiuntė: ${url}`);
  }
  for (const claim of sanitized.demotedClaims) {
    warnings.push(`Faktas ${claim.id} nenaudojamas (${DEMOTION_LT[claim.reason] ?? claim.reason}): ${claim.claim}`);
  }
  return gateResult('provenance', errors, warnings);
}

/** All URLs the article may link to or list as sources. */
export function factSheetUrls(factSheet: FactSheet): Set<string> {
  return new Set(factSheet.claims.flatMap((claim) => claim.sources.map((source) => normalizeUrl(source.url))));
}

/** Outbound links in the body and listed sources must come from the fact sheet. */
export function checkOutboundLinks(body: string, sourceUrls: string[], factSheet: FactSheet): GateResult {
  const allowed = factSheetUrls(factSheet);
  const errors: string[] = [];
  for (const link of markdownLinks(body)) {
    if (/^https?:\/\//i.test(link.url) && !allowed.has(normalizeUrl(link.url))) {
      errors.push(`Nuoroda ne iš faktų lapo: ${link.url}`);
    }
    if (/^(javascript|data|vbscript):/i.test(link.url)) errors.push(`Neleistina nuoroda: ${link.url}`);
  }
  for (const url of sourceUrls) {
    if (!allowed.has(normalizeUrl(url))) errors.push(`Šaltinis ne iš faktų lapo: ${url}`);
  }
  if (sourceUrls.length === 0) errors.push('Nėra šaltinių (sources).');
  return gateResult('links-allowlist', errors);
}
