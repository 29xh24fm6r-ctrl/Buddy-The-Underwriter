export function explainDecision(input: {
  overlays: any[];
  sop: any[];
}) {
  return {
    summary: "Conditionally approvable",
    drivers: input.overlays.map(o => o.rule),
    sop_citations: input.sop
  };
}
