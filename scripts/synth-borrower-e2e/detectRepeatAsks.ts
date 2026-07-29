/**
 * SPEC-M2 BEAT-METRICS-1 — repeat-ask regression detector.
 *
 * Pure function, no I/O: given the sequence of `nextRequiredFields`
 * snapshots returned by the concierge across a transcript's turns, detect
 * any field that was required, then dropped off the list (satisfied), and
 * later reappeared (asked again). That reappearance is exactly the
 * covenant violation the program doc calls out: "the interview NEVER asks
 * a key the fact registry shows answered." A field that never drops off
 * the list isn't a repeat ask — it just hasn't been answered yet.
 *
 * Kept separate from synth-borrower-e2e.ts (which does live HTTP I/O
 * against a deployed preview) so this logic is unit-testable without a
 * network call or a live deployment.
 */

export function detectRepeatAsks(nextRequiredSnapshots: string[][]): string[] {
  const seenThenDropped = new Set<string>();
  const currentlyRequired = new Set<string>();
  const repeats = new Set<string>();

  for (const snapshot of nextRequiredSnapshots) {
    const snapshotSet = new Set(snapshot);

    // Any field that was required before, dropped off (not in this
    // snapshot), and is now back → asked again after being satisfied.
    for (const field of snapshotSet) {
      if (seenThenDropped.has(field)) {
        repeats.add(field);
      }
    }

    // Fields required before but absent from this snapshot just dropped off.
    for (const field of currentlyRequired) {
      if (!snapshotSet.has(field)) {
        seenThenDropped.add(field);
      }
    }

    currentlyRequired.clear();
    for (const field of snapshotSet) currentlyRequired.add(field);
  }

  return [...repeats].sort();
}
