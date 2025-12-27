export function computeReadiness(events: any[]) {
  let score = 0.1;
  const blockers: string[] = [];

  if (events.some(e => e.kind === "borrower.connect.completed")) score += 0.25;
  else blockers.push("Connect accounts");

  if (events.some(e => e.kind === "preapproval.result")) score += 0.25;
  else blockers.push("Run pre-approval");

  if (events.some(e => e.kind === "autopilot.run.completed")) score += 0.4;

  return {
    score,
    label: score > 0.9 ? "E-Tran Ready" : score > 0.7 ? "Almost Ready" : "Not Ready",
    blockers
  };
}
