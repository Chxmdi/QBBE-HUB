/** A ledger line that could be a statement line: same amount, dates close. */
export interface MatchCandidate {
  bank_transaction_id: string;
  journal_line_id: string;
  day_gap: number;
}

/**
 * One suggestion per statement line, never the same ledger line twice. Pairs
 * with the smallest date gap are taken first, so an exact-date match wins
 * over a near one.
 */
export function pickSuggestions<T extends MatchCandidate>(candidates: T[]): Map<string, T> {
  const sorted = [...candidates].sort((a, b) => a.day_gap - b.day_gap);
  const picked = new Map<string, T>();
  const usedLines = new Set<string>();
  for (const c of sorted) {
    if (picked.has(c.bank_transaction_id) || usedLines.has(c.journal_line_id)) continue;
    picked.set(c.bank_transaction_id, c);
    usedLines.add(c.journal_line_id);
  }
  return picked;
}
