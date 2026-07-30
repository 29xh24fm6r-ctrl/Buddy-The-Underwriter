/**
 * SPEC-M4 FIX-CARDS-1 — pure comparison used by the fix-cards route to
 * decide whether the current set of gap keys differs from the most
 * recently emitted doc_request_round's gap-key set, so reloading the
 * portal doesn't spam a new "round" every time. Order-independent.
 */
export function gapKeySetChanged(currentGapKeys: string[], lastGapKeys: string[]): boolean {
  if (currentGapKeys.length !== lastGapKeys.length) return true;
  const sortedCurrent = [...currentGapKeys].sort();
  const sortedLast = [...lastGapKeys].sort();
  return sortedCurrent.some((k, i) => k !== sortedLast[i]);
}
