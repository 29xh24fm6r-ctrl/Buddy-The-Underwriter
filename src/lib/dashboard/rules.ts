// src/lib/dashboard/rules.ts

export type DealLike = {
  id: string;
  amount: number;
  stage: string;
  deal_type?: string | null;
  created_at?: string | null;
  anticipated_close_date?: string | null;
  closed_at?: string | null;
  assigned_to_user_id?: string | null;

  // Optional "signals" if your schema has them:
  missing_docs_count?: number | null;
  last_activity_at?: string | null;
  underwriter_assigned?: boolean | null;
};

function daysBetween(a: Date, b: Date) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function scoreDealRulesV1(deal: DealLike, now = new Date()) {
  let p = 50; // baseline probability
  const reasons: any[] = [];
  const flags: any[] = [];

  const amount = Number(deal.amount || 0);
  if (amount >= 2_000_000) {
    p -= 5;
    reasons.push({ kind: "complexity", weight: -5, note: "Large deal size typically increases cycle time." });
  } else if (amount <= 250_000) {
    p += 5;
    reasons.push({ kind: "simplicity", weight: +5, note: "Smaller deal size often closes faster." });
  }

  const stage = (deal.stage || "").toLowerCase();

  // Stage-based nudges (tune to your actual pipeline stages)
  const stageBoosts: Record<string, number> = {
    intake: -10,
    docs: -5,
    underwriting: +5,
    approval: +15,
    closing: +25,
    closed: +40,
    declined: -60,
  };

  for (const key of Object.keys(stageBoosts)) {
    if (stage.includes(key)) {
      p += stageBoosts[key];
      reasons.push({ kind: "stage", weight: stageBoosts[key], note: `Stage signal: ${deal.stage}` });
      break;
    }
  }

  // Missing docs
  const missing = Number(deal.missing_docs_count ?? 0);
  if (missing >= 5) {
    p -= 15;
    flags.push({ kind: "missing_docs", severity: "high", note: `${missing} missing documents.` });
  } else if (missing > 0) {
    p -= 5;
    flags.push({ kind: "missing_docs", severity: "medium", note: `${missing} missing documents.` });
  }

  // Staleness / activity
  if (deal.last_activity_at) {
    const last = new Date(deal.last_activity_at);
    const staleDays = daysBetween(last, now);
    if (staleDays >= 14) {
      p -= 15;
      flags.push({ kind: "stale", severity: "high", note: `No activity for ${staleDays} days.` });
    } else if (staleDays >= 7) {
      p -= 8;
      flags.push({ kind: "stale", severity: "medium", note: `No activity for ${staleDays} days.` });
    } else {
      p += 4;
      reasons.push({ kind: "activity", weight: +4, note: "Recent activity supports momentum." });
    }
  }

  // Underwriter assigned
  if (deal.underwriter_assigned === false) {
    p -= 10;
    flags.push({ kind: "no_uw", severity: "high", note: "No underwriter assigned." });
  } else if (deal.underwriter_assigned === true) {
    p += 6;
    reasons.push({ kind: "uw", weight: +6, note: "Underwriter assigned." });
  }

  // ETA (simple heuristic): based on stage and anticipated close date
  let eta: string | null = deal.anticipated_close_date || null;
  if (!eta) {
    const days =
      stage.includes("closing") ? 10 :
      stage.includes("approval") ? 21 :
      stage.includes("underwriting") ? 35 :
      stage.includes("docs") ? 45 :
      60;
    const d = new Date(now.getTime() + days * 24 * 3600 * 1000);
    eta = d.toISOString().slice(0, 10);
  }

  // Clamp
  p = Math.max(0, Math.min(100, p));

  return { probability: p, eta_close_date: eta, risk_flags: flags, reasons };
}
