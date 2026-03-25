/**
 * Committee-grade exception narrative generation.
 * Combines exception records, mitigants, and decisions into
 * committee-ready text suitable for memo/package inclusion.
 * Pure module — no DB, no server-only.
 */

// ── Types ────────────────────────────────────────────────────────

export type ExceptionRecord = {
  id: string;
  exception_key: string;
  exception_type: string;
  severity: string;
  title: string;
  description: string;
  policy_reference?: string | null;
  detected_value?: number | null;
  policy_limit_value?: number | null;
  status: string;
  first_detected_at: string;
};

export type ExceptionAction = {
  exception_id: string;
  action_type: string;
  mitigant_text?: string | null;
  rationale_text?: string | null;
  acted_by?: string | null;
  acted_at: string;
};

export type CommitteeExceptionNarrative = {
  exception_register_summary: string;
  key_exception_narratives: Array<{
    exception_id: string;
    title: string;
    narrative: string;
  }>;
  mitigants_summary: string;
  recommendation_support: string;
};

// ── Generator ────────────────────────────────────────────────────

export function generateCommitteeExceptionNarrative(
  exceptions: ExceptionRecord[],
  actions: ExceptionAction[],
): CommitteeExceptionNarrative {
  const active = exceptions.filter((e) => e.status !== "resolved");
  const actionsByException = groupBy(actions, (a) => a.exception_id);

  return {
    exception_register_summary: generateRegisterSummary(exceptions, active),
    key_exception_narratives: active.map((e) =>
      generateSingleExceptionNarrative(e, actionsByException.get(e.id) ?? []),
    ),
    mitigants_summary: generateMitigantsSummary(active, actionsByException),
    recommendation_support: generateRecommendation(exceptions, active),
  };
}

// ── Register summary ─────────────────────────────────────────────

function generateRegisterSummary(all: ExceptionRecord[], active: ExceptionRecord[]): string {
  if (all.length === 0) {
    return "No policy exceptions have been identified for this transaction.";
  }

  const resolved = all.filter((e) => e.status === "resolved").length;
  const open = active.filter((e) => e.status === "open").length;
  const mitigated = active.filter((e) => e.status === "mitigated").length;
  const approved = active.filter((e) => e.status === "approved" || e.status === "waived").length;

  const parts: string[] = [];
  parts.push(`${all.length} policy exception${all.length > 1 ? "s" : ""} identified.`);

  const statuses: string[] = [];
  if (open > 0) statuses.push(`${open} open`);
  if (mitigated > 0) statuses.push(`${mitigated} mitigated`);
  if (approved > 0) statuses.push(`${approved} approved/waived`);
  if (resolved > 0) statuses.push(`${resolved} resolved`);

  if (statuses.length > 0) {
    parts.push(`Status: ${statuses.join(", ")}.`);
  }

  return parts.join(" ");
}

// ── Single exception narrative ───────────────────────────────────

function generateSingleExceptionNarrative(
  exc: ExceptionRecord,
  excActions: ExceptionAction[],
): { exception_id: string; title: string; narrative: string } {
  const parts: string[] = [];

  // Core description
  parts.push(exc.description);

  // Policy reference
  if (exc.policy_reference) {
    parts.push(`Policy reference: ${exc.policy_reference}.`);
  }

  // Variance
  if (exc.detected_value != null && exc.policy_limit_value != null) {
    const variance = Math.abs(exc.detected_value - exc.policy_limit_value);
    if (exc.exception_type === "ltv_exceeded") {
      parts.push(`Variance: ${(variance * 100).toFixed(1)} percentage points above limit.`);
    } else if (exc.exception_type === "equity_shortfall") {
      parts.push(`Shortfall: ${(variance * 100).toFixed(0)} percentage points.`);
    }
  }

  // Mitigants
  const mitigants = excActions
    .filter((a) => a.action_type === "add_mitigant" && a.mitigant_text)
    .map((a) => a.mitigant_text!);

  if (mitigants.length > 0) {
    parts.push(`Compensating factors: ${mitigants.join(" ")}`);
  }

  // Current disposition
  const statusLabel = STATUS_LABELS[exc.status] ?? exc.status;
  parts.push(`Current disposition: ${statusLabel}.`);

  return {
    exception_id: exc.id,
    title: exc.title,
    narrative: parts.join(" "),
  };
}

// ── Mitigants summary ────────────────────────────────────────────

function generateMitigantsSummary(
  active: ExceptionRecord[],
  actionsByException: Map<string, ExceptionAction[]>,
): string {
  const allMitigants: string[] = [];

  for (const exc of active) {
    const excActions = actionsByException.get(exc.id) ?? [];
    const mitigants = excActions
      .filter((a) => a.action_type === "add_mitigant" && a.mitigant_text)
      .map((a) => a.mitigant_text!);
    allMitigants.push(...mitigants);
  }

  if (allMitigants.length === 0) {
    return "No compensating factors have been documented.";
  }

  return `Compensating factors documented across ${active.length} active exception${active.length > 1 ? "s" : ""}: ${allMitigants.join(" ")}`;
}

// ── Recommendation ───────────────────────────────────────────────

function generateRecommendation(all: ExceptionRecord[], active: ExceptionRecord[]): string {
  if (all.length === 0) {
    return "The transaction is within policy. No exceptions require committee consideration.";
  }

  const open = active.filter((e) => e.status === "open");
  const mitigated = active.filter((e) => e.status === "mitigated");
  const approved = active.filter((e) => e.status === "approved" || e.status === "waived");

  if (open.length === 0 && mitigated.length === 0) {
    if (approved.length > 0) {
      return `All policy exceptions have been resolved or approved. ${approved.length} exception${approved.length > 1 ? "s" : ""} approved/waived with documented mitigants.`;
    }
    return "All policy exceptions have been resolved. The transaction is within policy.";
  }

  if (open.length > 0) {
    return `${open.length} policy exception${open.length > 1 ? "s remain" : " remains"} open and require${open.length === 1 ? "s" : ""} committee consideration before final approval.`;
  }

  return `${mitigated.length} policy exception${mitigated.length > 1 ? "s" : ""} mitigated with documented compensating factors, pending formal approval.`;
}

// ── Helpers ──────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  open: "Open — pending review",
  mitigated: "Mitigated — compensating factors documented",
  waived: "Waived by authorized approver",
  approved: "Approved with exception",
  rejected: "Rejected — structure not approved as proposed",
  resolved: "Resolved — exception condition no longer exists",
};

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  return map;
}
