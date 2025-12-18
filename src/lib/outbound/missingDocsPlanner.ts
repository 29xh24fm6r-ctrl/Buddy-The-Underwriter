/**
 * MEGA STEP 12: Missing Docs Planner
 * 
 * Builds smart borrower requests showing EXACT missing items:
 * - "Have years: 2023. Need 2 distinct years (missing 1)."
 * - "Have months: 2025-01, 2025-02, 2025-03. Need 6 distinct months (missing 3)."
 * 
 * Not generic "Upload tax returns" — deterministic gap analysis.
 */

export type Rule = {
  condition_key: string;
  doc_type: string;
  min_confidence?: number | null;
  matcher?: any;
  enabled?: boolean;
};

export type Condition = {
  id: string;
  title: string;
  condition_type?: string;
  satisfied: boolean | null;
  evidence?: any;
};

export type MissingDocsPlan = {
  open_count: number;
  open: { title: string; why?: string }[];
};

export function buildMissingDocsPlan(args: {
  rulesByKey: Map<string, Rule>;
  conditions: Condition[];
}): MissingDocsPlan {
  const open = (args.conditions ?? [])
    .filter((c) => !c?.satisfied) // treats null as missing (desired)
    .map((c) => ({
      title: c.title,
      why:
        c?.evidence?.why_this_is_next_action ??
        c?.evidence?.reason ??
        undefined,
    }));

  return { open_count: open.length, open };
}

export function renderMissingDocsEmail(
  dealName: string,
  borrowerName: string | null,
  plan: MissingDocsPlan
) {
  const subject =
    plan.open_count > 0
      ? `${dealName} — Missing Documents (${plan.open_count})`
      : `${dealName} — Documents Complete`;

  const greeting = borrowerName ? `Hi ${borrowerName},` : "Hi,";

  const body =
    plan.open_count === 0
      ? `${greeting}\n\nGood news — we have everything we need at this time.\n\nThank you,`
      : `${greeting}\n\nPlease upload the following documents:\n\n` +
        plan.open.map((x, i) => `  ${i + 1}. ${x.title}${x.why ? ` — ${x.why}` : ""}`).join("\n") +
        `\n\nThank you,`;

  return { subject, body };
}
