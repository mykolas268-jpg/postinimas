export interface GateResult {
  gate: string;
  passed: boolean;
  /** Blocking problems (fed back to the writer in a revision loop). */
  errors: string[];
  /** Non-blocking findings, always listed in the PR for the human reviewer. */
  warnings: string[];
  /** Set when the gate could not run (e.g. hunspell missing). */
  skipped?: string;
}

export function gateResult(gate: string, errors: string[], warnings: string[] = [], skipped?: string): GateResult {
  return { gate, passed: errors.length === 0, errors, warnings, ...(skipped ? { skipped } : {}) };
}
