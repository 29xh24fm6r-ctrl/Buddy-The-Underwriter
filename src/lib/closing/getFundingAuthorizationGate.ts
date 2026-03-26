import "server-only";

/**
 * Phase 57 — Funding Authorization Gate
 *
 * Determines whether a deal is truly ready to fund.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveClosingExecutionState } from "./deriveClosingExecutionState";

export type FundingGate = {
  ok: boolean;
  reasons: string[];
  executionComplete: boolean;
  signaturesRemaining: number;
  conditionsRemaining: number;
  activePackageId: string | null;
  fundingAuthorized: boolean;
};

export async function getFundingAuthorizationGate(dealId: string): Promise<FundingGate> {
  const sb = supabaseAdmin();
  const reasons: string[] = [];

  // Load active package
  const { data: pkg } = await sb
    .from("closing_packages")
    .select("id")
    .eq("deal_id", dealId)
    .neq("status", "superseded")
    .neq("status", "failed")
    .order("generation_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pkg) {
    return { ok: false, reasons: ["No active closing package"], executionComplete: false, signaturesRemaining: 0, conditionsRemaining: 0, activePackageId: null, fundingAuthorized: false };
  }

  // Load execution run
  const { data: run } = await sb
    .from("closing_execution_runs")
    .select("id, status")
    .eq("closing_package_id", pkg.id)
    .maybeSingle();

  if (!run) {
    reasons.push("No execution run exists for active package");
  }

  // Load recipients + conditions for derivation
  const { data: docs } = await sb
    .from("closing_package_documents")
    .select("id")
    .eq("closing_package_id", pkg.id);

  const docIds = (docs ?? []).map((d: any) => d.id);

  let recipients: any[] = [];
  if (docIds.length > 0) {
    const { data: recs } = await sb
      .from("closing_document_recipients")
      .select("required, action_type, status")
      .in("closing_package_document_id", docIds);
    recipients = recs ?? [];
  }

  const { data: conditions } = await sb
    .from("closing_condition_states")
    .select("required, status")
    .eq("closing_package_id", pkg.id);

  const derived = deriveClosingExecutionState({
    recipients: recipients.map((r: any) => ({ required: r.required, actionType: r.action_type, status: r.status })),
    conditions: (conditions ?? []).map((c: any) => ({ required: c.required, status: c.status })),
    currentStatus: run?.status ?? "draft",
    isCancelled: run?.status === "cancelled",
    isSuperseded: run?.status === "superseded",
  });

  if (!derived.executionComplete) {
    if (derived.signaturesRemaining > 0) reasons.push(`${derived.signaturesRemaining} signature(s) remaining`);
    if (derived.conditionsRemaining > 0) reasons.push(`${derived.conditionsRemaining} closing condition(s) remaining`);
    if (!run) reasons.push("Execution not started");
  }

  // Check funding authorization
  const { data: auth } = await sb
    .from("funding_authorizations")
    .select("status")
    .eq("closing_package_id", pkg.id)
    .eq("status", "authorized")
    .maybeSingle();

  const fundingAuthorized = Boolean(auth);
  if (!fundingAuthorized && derived.executionComplete) {
    reasons.push("Funding not yet authorized");
  }

  return {
    ok: derived.executionComplete && fundingAuthorized && reasons.length === 0,
    reasons,
    executionComplete: derived.executionComplete,
    signaturesRemaining: derived.signaturesRemaining,
    conditionsRemaining: derived.conditionsRemaining,
    activePackageId: pkg.id,
    fundingAuthorized,
  };
}
