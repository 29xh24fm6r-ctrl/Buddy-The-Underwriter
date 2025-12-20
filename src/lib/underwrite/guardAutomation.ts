// src/lib/underwrite/guardAutomation.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

type Guard = {
  dealId: string;
  severity: "BLOCKED" | "WARN" | "READY";
  issues: Array<{
    code: string;
    severity: "BLOCKED" | "WARN";
    title: string;
    detail: string;
    fix: { label: string; target: { kind: string; dealId: string } };
  }>;
  stats: { blockedCount: number; warnCount: number };
};

function stableHash(input: any): string {
  // Deterministic, low-risk hash (no crypto dependency); good enough for de-dupe.
  // If you prefer crypto, swap to node:crypto sha256. Keeping dependency-free.
  const s = JSON.stringify(input ?? {});
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a_${(h >>> 0).toString(16)}`;
}

function borrowerSafeStatus(sev: Guard["severity"]) {
  // Borrower-safe: NEVER expose reasons/codes. Only a simple status.
  if (sev === "READY") return "Underwriting status updated: ready for review.";
  if (sev === "WARN") return "Underwriting status updated: in progress.";
  return "Underwriting status updated: awaiting information.";
}

function mapIssueToEvidence(issue: Guard["issues"][number]) {
  // Evidence is banker-safe and used in Next Actions. Keep it minimal.
  return [
    { label: "Code", value: issue.code, source: "guard" },
    { label: "Severity", value: issue.severity, source: "guard" },
  ];
}

function shouldNudgeBorrower(issueCode: string) {
  // Only nudge on borrower-actionable items.
  // Keep conservative to avoid spam.
  return (
    issueCode === "UW_MISSING_PURPOSE" ||
    issueCode === "UW_MISSING_AMOUNT" ||
    issueCode === "UW_MISSING_TERM" ||
    issueCode === "UW_MISSING_PRODUCT"
  );
}

function nudgeMessageForIssue(issue: Guard["issues"][number]) {
  // Borrower-safe phrasing: request info, no risk/credit language.
  switch (issue.code) {
    case "UW_MISSING_PRODUCT":
      return "Quick question: which loan product(s) are you requesting (SBA 7(a), SBA 504, Line of Credit, Equipment, etc.)? You can add it in the portal under Loan Request.";
    case "UW_MISSING_AMOUNT":
      return "Can you confirm the requested loan amount? You can update it in the portal under Loan Request.";
    case "UW_MISSING_TERM":
      return "Can you confirm the desired term (in months or years)? You can update it in the portal under Loan Request.";
    case "UW_MISSING_PURPOSE":
      return "Can you share a short summary of the purpose / use of proceeds (e.g., purchase, refinance, working capital, equipment)? You can add it in the portal under Loan Request.";
    default:
      return null;
  }
}

export async function applyGuardAutomation(input: { bankerUserId: string; guard: Guard }) {
  const sb = supabaseAdmin();
  const dealId = input.guard.dealId;

  // 1) Load prior state
  const { data: prevRow } = await sb
    .from("deal_underwrite_guard_states")
    .select("deal_id, severity, issues_hash")
    .eq("deal_id", dealId)
    .maybeSingle();

  const nextHash = stableHash({
    severity: input.guard.severity,
    issues: input.guard.issues.map((i) => ({ code: i.code, severity: i.severity })), // don't hash full text
  });

  const prevSeverity = (prevRow?.severity as Guard["severity"] | undefined) ?? null;
  const prevHash = (prevRow?.issues_hash as string | undefined) ?? null;

  const changed = prevHash !== nextHash || prevSeverity !== input.guard.severity;

  // 2) Upsert guard state
  await sb.from("deal_underwrite_guard_states").upsert(
    {
      deal_id: dealId,
      severity: input.guard.severity,
      blocked_count: input.guard.stats.blockedCount,
      warn_count: input.guard.stats.warnCount,
      issues: input.guard.issues as any,
      issues_hash: nextHash,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "deal_id" }
  );

  // If nothing changed, do nothing else (prevents duplicate timeline/next-actions spam)
  if (!changed) {
    return { ok: true, changed: false };
  }

  // 3) Timeline events on transitions (banker-only detail + borrower-safe status)
  const bankerTitle = `Underwrite status: ${prevSeverity ?? "—"} → ${input.guard.severity}`;
  const bankerDetail =
    input.guard.severity === "READY"
      ? "All required underwriting inputs are present."
      : input.guard.severity === "WARN"
      ? "Underwriting inputs are partially complete."
      : "Underwriting is blocked by missing inputs.";

  await sb.from("deal_timeline_events").insert([
    {
      deal_id: dealId,
      visibility: "banker",
      event_type: "UNDERWRITE_GUARD_TRANSITION",
      title: bankerTitle,
      detail: bankerDetail,
      meta: { prevSeverity, nextSeverity: input.guard.severity, blocked: input.guard.stats.blockedCount, warn: input.guard.stats.warnCount },
    },
    {
      deal_id: dealId,
      visibility: "borrower",
      event_type: "UNDERWRITE_STATUS_UPDATED",
      title: "Application status updated",
      detail: borrowerSafeStatus(input.guard.severity),
      meta: { status: input.guard.severity },
    },
  ]);

  // 4) Next Actions: upsert open actions for each current issue; auto-complete stale ones
  // Fetch existing open actions
  const { data: existingOpen } = await sb
    .from("deal_next_actions")
    .select("id, code, status")
    .eq("deal_id", dealId)
    .eq("status", "open");

  const openCodes = new Set((existingOpen ?? []).map((r: any) => String(r.code)));
  const currentCodes = new Set(input.guard.issues.map((i) => i.code));

  // Create new open actions for issues not yet open
  const toCreate = input.guard.issues.filter((i) => !openCodes.has(i.code));
  if (toCreate.length) {
    await sb.from("deal_next_actions").insert(
      toCreate.map((i) => ({
        deal_id: dealId,
        visibility: "banker",
        status: "open",
        code: i.code,
        title: i.title,
        detail: i.detail,
        evidence: mapIssueToEvidence(i),
        action_target: i.fix?.target ?? { kind: "deal_cockpit", dealId },
      }))
    );
  }

  // Auto-complete open actions that are no longer present
  const toClose = (existingOpen ?? []).filter((r: any) => !currentCodes.has(String(r.code)));
  if (toClose.length) {
    const ids = toClose.map((r: any) => r.id);
    await sb.from("deal_next_actions").update({ status: "done" }).in("id", ids);
  }

  // 5) Auto-nudge drafts (never send automatically)
  // Create a draft only if:
  // - guard is BLOCKED or WARN (not READY)
  // - there is a borrower-actionable issue
  // - no existing DRAFT for that issue code in meta
  if (input.guard.severity !== "READY") {
    const actionable = input.guard.issues.filter((i) => shouldNudgeBorrower(i.code));
    if (actionable.length) {
      const { data: drafts } = await sb
        .from("deal_message_drafts")
        .select("id, status, meta")
        .eq("deal_id", dealId)
        .in("status", ["draft", "approved"]);

      const existingIssueCodes = new Set(
        (drafts ?? [])
          .map((d: any) => d?.meta?.issueCode)
          .filter(Boolean)
          .map((x: any) => String(x))
      );

      for (const issue of actionable) {
        if (existingIssueCodes.has(issue.code)) continue;

        const msg = nudgeMessageForIssue(issue);
        if (!msg) continue;

        await sb.from("deal_message_drafts").insert({
          deal_id: dealId,
          to_role: "borrower",
          status: "draft",
          body: msg,
          created_by: input.bankerUserId,
          meta: { issueCode: issue.code, guardSeverity: input.guard.severity },
        });
      }
    }
  }

  return { ok: true, changed: true };
}
