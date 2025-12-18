// src/lib/outbound/autoSendTick.ts

import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildMissingDocsPlan,
  renderMissingDocsEmail,
} from "@/lib/outbound/missingDocsPlanner";

/**
 * We are deliberately NOT auto-emailing right now.
 * This module's job is to:
 *  - compute the "missing docs" plan for a deal
 *  - upsert/update a borrower draft message (so banker can copy/paste)
 *  - cancel that draft if there are no missing docs
 *
 * NOTE: Supabase DB types are not generated yet in this repo, so we use `as any`
 * to avoid the "parameter of type 'never'" TS errors.
 */

const KIND = "missing_docs"; // draft kind fingerprinting / grouping

function sha(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

type UpsertArgs = {
  sb: any;
  dealId: string;
  dealName?: string | null;
};

type ConditionRow = {
  id: string;
  condition_type: string | null;
  title: string | null;
  satisfied: boolean | null;
  evidence: any | null;
};

type MatchRuleRow = {
  condition_key: string;
  doc_type: string | null;
  min_confidence: number | null;
  matcher: any | null;
  enabled: boolean | null;
};

type DraftRow = {
  id: string;
  deal_id: string;
  kind: string | null;
  status: string | null;
  subject: string | null;
  body: string | null;
  fingerprint: string | null;
  updated_at?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  sent_at?: string | null;
  sent_via?: string | null;
  rejection_reason?: any | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
};

async function loadMissingDocsInputs(sb: any, dealId: string) {
  const { data: rules, error: e1 } = await sb
    .from("condition_match_rules")
    .select("condition_key, doc_type, min_confidence, matcher, enabled")
    .eq("enabled", true);

  if (e1) throw e1;

  const rulesByKey = new Map<string, any>();
  for (const r of (rules ?? []) as MatchRuleRow[]) {
    if (!r?.condition_key) continue;
    rulesByKey.set(r.condition_key, r);
  }

  const { data: conds, error: e2 } = await sb
    .from("conditions_to_close")
    .select("id, condition_type, title, satisfied, evidence")
    .eq("deal_id", dealId);

  if (e2) throw e2;

  // Map database rows to Condition type expected by buildMissingDocsPlan
  const conditions = (conds ?? []).map((c: ConditionRow) => ({
    id: c.id,
    title: c.title ?? "Untitled condition",
    condition_type: c.condition_type ?? undefined,
    satisfied: c.satisfied,
    evidence: c.evidence ?? undefined,
  }));

  return {
    rulesByKey,
    conditions,
  };
}

/**
 * Cancel any existing missing-docs drafts when there are no open items.
 */
async function cancelMissingDocsDrafts(sb: any, dealId: string) {
  const patch = {
    status: "cancelled",
    updated_at: nowIso(),
  };

  const { error } = await sb
    .from("deal_message_drafts")
    .update(patch as any)
    .eq("deal_id", dealId)
    .eq("kind", KIND)
    .in("status", ["draft", "pending_approval"]);

  if (error) throw error;
}

/**
 * Ensure there is exactly one "current" draft with the latest fingerprint.
 * - If fingerprint unchanged: noop
 * - If changed: upsert new/updated row, set status=draft (unless already pending_approval/approved)
 */
async function upsertMissingDocsDraft(args: UpsertArgs) {
  const { sb, dealId, dealName } = args;

  const { rulesByKey, conditions } = await loadMissingDocsInputs(sb, dealId);

  const plan = buildMissingDocsPlan({
    rulesByKey,
    conditions,
  });

  if (!plan || plan.open_count === 0) {
    await cancelMissingDocsDrafts(sb, dealId);
    return { ok: true, cancelled: true, open_count: 0 };
  }

  const email = renderMissingDocsEmail(
    dealName ?? "Untitled Deal",
    null,
    plan
  );

  const fingerprint = sha(
    `${dealId}|${KIND}|${email.subject ?? ""}|${email.body ?? ""}`
  );

  // Load current draft (latest)
  const { data: existing, error: e0 } = await sb
    .from("deal_message_drafts")
    .select("*")
    .eq("deal_id", dealId)
    .eq("kind", KIND)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (e0) throw e0;

  const cur = (existing ?? null) as DraftRow | null;

  // If unchanged, noop
  if (cur?.fingerprint && cur.fingerprint === fingerprint) {
    return { ok: true, unchanged: true, draft_id: cur.id, open_count: plan.open_count };
  }

  // If the current draft is already approved/sent, we create a fresh draft row.
  const curStatus = (cur?.status ?? "").toLowerCase();
  const isLocked =
    curStatus === "approved" || curStatus === "sent";

  const payload = {
    deal_id: dealId,
    kind: KIND,
    status: isLocked ? "draft" : (cur?.status ?? "draft"),
    subject: email.subject ?? "Missing documents request",
    body: email.body ?? "",
    fingerprint,
    updated_at: nowIso(),
  };

  if (cur?.id && !isLocked) {
    // Update current row
    const { data: updated, error: e3 } = await sb
      .from("deal_message_drafts")
      .update(payload as any)
      .eq("id", cur.id)
      .select("*")
      .single();

    if (e3) throw e3;

    return {
      ok: true,
      updated: true,
      draft_id: (updated as any)?.id ?? cur.id,
      open_count: plan.open_count,
    };
  }

  // Insert new row
  const { data: inserted, error: e4 } = await sb
    .from("deal_message_drafts")
    .insert(payload as any)
    .select("*")
    .single();

  if (e4) throw e4;

  return {
    ok: true,
    inserted: true,
    draft_id: (inserted as any)?.id,
    open_count: plan.open_count,
  };
}

/**
 * Public entrypoint:
 * Called by admin tick / orchestrator.
 * DOES NOT SEND EMAIL. Only keeps the draft synced.
 */
export async function tickAutoSendMissingDocsDraft(params: {
  dealId: string;
  dealName?: string | null;
}) {
  const sb = supabaseAdmin() as any;
  return upsertMissingDocsDraft({
    sb,
    dealId: params.dealId,
    dealName: params.dealName ?? null,
  });
}

/**
 * Batch tick processor for multiple deals
 */
export async function autoSendTick(sb: any, limit: number = 25) {
  const { data: deals, error } = await sb
    .from("deals")
    .select("id, name")
    .eq("status", "active")
    .limit(limit);

  if (error) throw error;

  const results = [];
  for (const deal of deals ?? []) {
    try {
      const result = await upsertMissingDocsDraft({
        sb,
        dealId: deal.id,
        dealName: deal.name,
      });
      results.push({ deal_id: deal.id, ...result });
    } catch (err: any) {
      results.push({ deal_id: deal.id, ok: false, error: err?.message ?? String(err) });
    }
  }

  return results;
}
