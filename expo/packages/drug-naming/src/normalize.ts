/** Normalize free-text drug names and NDC strings for lookup. */
export function normalizeDrugQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract a product / NDC code string from a scanned barcode payload. */
export function extractProductCodeFromBarcode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  const ndcLike = trimmed.match(/\d{4,5}-\d{3,4}-\d{1,2}/);
  if (ndcLike) {
    return ndcLike[0]!;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 10) {
    return digits;
  }

  return trimmed;
}

/** Normalize NDC to 11 digits (no dashes) when possible. */
export function normalizeNdc(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) {
    return `0${digits}`;
  }
  if (digits.length === 11) {
    return digits;
  }
  return null;
}

function tokenOverlapScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.startsWith(a) || a.startsWith(b)) return 0.88;
  if (b.includes(a) || a.includes(b)) return 0.72;
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared += 1;
  }
  return shared / Math.max(aTokens.size, bTokens.size) * 0.65;
}

/** Score how well `query` matches a catalog term (0–1). */
export function scoreDrugTermMatch(query: string, term: string): number {
  const normalizedQuery = normalizeDrugQuery(query);
  const normalizedTerm = normalizeDrugQuery(term);
  if (!normalizedQuery || !normalizedTerm) return 0;
  return tokenOverlapScore(normalizedQuery, normalizedTerm);
}

export { tokenOverlapScore as scoreTermOverlapForTests };
