export function arbitrateClaims(agentFindings: any[]) {
  // Pick highest confidence claim
  const sorted = [...agentFindings].sort(
    (a, b) => b.confidence - a.confidence
  );

  return {
    chosen: sorted[0],
    dissent: sorted.slice(1)
  };
}
