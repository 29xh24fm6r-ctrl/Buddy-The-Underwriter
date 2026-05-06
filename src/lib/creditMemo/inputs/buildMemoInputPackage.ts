// Server-only assembler for the Memo Input Package.
//
// Loads every required input source (borrower story, management, collateral,
// financial facts, snapshot, research, conflicts, banker overrides),
// evaluates readiness, and returns a single self-contained package the
// submission pipeline writes into the immutable Florida Armory snapshot.

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { evaluateMemoInputReadiness } from "./evaluateMemoInputReadiness";
import {
  loadAllFactConflicts,
  reconcileDealFacts,
} from "./reconcileDealFacts";
import { writeMemoInputReadinessRow } from "./writeMemoInputReadiness";
import { migrateLegacyOverridesToCanonical } from "./migrateLegacyOverridesAsync";
import type {
  DealBorrowerStory,
  DealCollateralItem,
  DealManagementProfile,
  MemoInputPackage,
  RequiredFinancialFacts,
  ResearchGateSnapshot,
} from "./types";

export type BuildMemoInputPackageArgs = {
  dealId: string;
  // When true, run reconcileDealFacts before assembling. The submission
  // pipeline always wants this (so snapshot reflects the latest reconciliation
  // run); admin-style read paths can pass false to avoid mutating state.
  runReconciliation?: boolean;
};

export type BuildMemoInputPackageResult =
  | { ok: true; package: MemoInputPackage; bankId: string }
  | {
      ok: false;
      reason: "tenant_mismatch" | "load_failed";
      error?: string;
    };

export async function buildMemoInputPackage(
  args: BuildMemoInputPackageArgs,
): Promise<BuildMemoInputPackageResult> {
  const access = await ensureDealBankAccess(args.dealId);
  if (!access.ok) {
    return { ok: false, reason: "tenant_mismatch", error: access.error };
  }
  const { bankId } = access;
  const sb = supabaseAdmin();

  if (args.runReconciliation) {
    await reconcileDealFacts({ dealId: args.dealId });
  }

  // SPEC-13 — auto-migration of legacy `deal_memo_overrides` JSON into
  // canonical `deal_borrower_story` + `deal_management_profiles` rows.
  // Gated on: borrower-story is empty AND legacy overrides are present.
  // The wrapper itself is idempotent (it re-checks borrower-story
  // existence inside the transaction), so re-entering this block on a
  // racing build is safe.
  let borrowerStory = await loadBorrowerStory(sb, args.dealId, bankId);
  if (borrowerStory === null) {
    const legacy = await loadBankerOverrides(sb, args.dealId, bankId);
    if (Object.keys(legacy).length > 0) {
      try {
        await migrateLegacyOverridesToCanonical({
          dealId: args.dealId,
          bankId,
          overrides: legacy,
        });
      } catch (err) {
        // Migration is best-effort — never block package assembly.
        console.warn("[memo-inputs] legacy override migration failed", err);
      }
      // Re-load borrower-story so the readiness evaluator sees the
      // freshly-written row.
      borrowerStory = await loadBorrowerStory(sb, args.dealId, bankId);
    }
  }

  const [
    management,
    collateral,
    financialFacts,
    snapshot,
    research,
    conflicts,
    overrides,
    unfinalizedDocCount,
    policyExceptionsReviewed,
  ] = await Promise.all([
    loadManagementProfiles(sb, args.dealId, bankId),
    loadCollateralItems(sb, args.dealId, bankId),
    loadRequiredFinancialFacts(sb, args.dealId, bankId),
    loadLatestSnapshot(sb, args.dealId),
    loadResearchGateSnapshot(sb, args.dealId),
    loadAllFactConflicts({ dealId: args.dealId, bankId }),
    loadBankerOverrides(sb, args.dealId, bankId),
    loadUnfinalizedRequiredDocCount(sb, args.dealId, bankId),
    loadPolicyExceptionsReviewed(sb, args.dealId, bankId),
  ]);

  const readiness = evaluateMemoInputReadiness({
    dealId: args.dealId,
    borrowerStory,
    management,
    collateral,
    financialFacts,
    research,
    conflicts: conflicts.filter(
      (c) => c.status === "open" || c.status === "acknowledged",
    ),
    unfinalizedDocCount,
    policyExceptionsReviewed,
  });

  // Cache readiness for the Memo Inputs UI. Best-effort — never blocks the
  // package from being returned.
  await writeMemoInputReadinessRow({
    dealId: args.dealId,
    bankId,
    readiness,
  });

  const pkg: MemoInputPackage = {
    deal_id: args.dealId,
    bank_id: bankId,
    borrower_story: borrowerStory,
    management_profiles: management,
    collateral_items: collateral,
    financial_facts: financialFacts,
    financial_snapshot: snapshot,
    research,
    conflicts,
    banker_overrides: { overrides },
    readiness,
    package_version: "memo_input_package_v1",
    assembled_at: new Date().toISOString(),
  };

  return { ok: true, package: pkg, bankId };
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

async function loadBorrowerStory(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
): Promise<DealBorrowerStory | null> {
  const { data } = await (sb as any)
    .from("deal_borrower_story")
    .select("*")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .maybeSingle();
  return data ? (data as DealBorrowerStory) : null;
}

async function loadManagementProfiles(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
): Promise<DealManagementProfile[]> {
  const { data } = await (sb as any)
    .from("deal_management_profiles")
    .select("*")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("ownership_pct", { ascending: false, nullsFirst: false });
  return (data ?? []) as DealManagementProfile[];
}

async function loadCollateralItems(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
): Promise<DealCollateralItem[]> {
  const { data } = await (sb as any)
    .from("deal_collateral_items")
    .select("*")
    .eq("deal_id", dealId);
  return ((data ?? []) as any[])
    .filter((r) => r.bank_id === null || r.bank_id === bankId)
    .map(
      (r): DealCollateralItem => ({
        id: r.id,
        deal_id: r.deal_id,
        bank_id: r.bank_id ?? null,
        collateral_type: r.collateral_type ?? r.item_type ?? null,
        description: r.description ?? null,
        owner_name: r.owner_name ?? null,
        market_value: numOrNull(r.market_value),
        appraised_value: numOrNull(r.appraised_value ?? r.estimated_value),
        discounted_value: numOrNull(r.discounted_value),
        advance_rate: numOrNull(r.advance_rate),
        lien_position:
          typeof r.lien_position === "string"
            ? r.lien_position
            : typeof r.lien_position === "number"
            ? String(r.lien_position)
            : null,
        valuation_date: r.valuation_date ?? r.appraisal_date ?? null,
        valuation_source: r.valuation_source ?? null,
        source_document_id: r.source_document_id ?? null,
        confidence: numOrNull(r.confidence),
        requires_review: r.requires_review === true,
      }),
    );
}

async function loadRequiredFinancialFacts(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
): Promise<RequiredFinancialFacts> {
  const { data } = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, period_end, created_at")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("is_superseded", false)
    .in("fact_key", [
      "dscr",
      "annual_debt_service",
      "global_cash_flow",
      "loan_amount",
    ]);

  // Pick the most recent value per fact_key.
  const latest = new Map<string, { value: number | null; recorded: string }>();
  for (const r of (data ?? []) as Array<{
    fact_key: string;
    fact_value_num: number | null;
    created_at: string | null;
  }>) {
    const recorded = r.created_at ?? "";
    const cur = latest.get(r.fact_key);
    if (!cur || recorded > cur.recorded) {
      latest.set(r.fact_key, { value: r.fact_value_num ?? null, recorded });
    }
  }

  return {
    dscr: latest.get("dscr")?.value ?? null,
    annualDebtService: latest.get("annual_debt_service")?.value ?? null,
    globalCashFlow: latest.get("global_cash_flow")?.value ?? null,
    loanAmount: latest.get("loan_amount")?.value ?? null,
  };
}

async function loadLatestSnapshot(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<unknown> {
  const { data } = await (sb as any)
    .from("deal_financial_snapshots")
    .select("snapshot_json, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? (data as any).snapshot_json ?? null : null;
}

async function loadResearchGateSnapshot(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<ResearchGateSnapshot | null> {
  const { data: missions } = await (sb as any)
    .from("buddy_research_missions")
    .select("id")
    .eq("deal_id", dealId)
    .eq("status", "complete")
    .order("completed_at", { ascending: false })
    .limit(1);

  if (!missions || missions.length === 0) return null;
  const missionId = (missions[0] as { id: string }).id;

  const { data: gate } = await (sb as any)
    .from("buddy_research_quality_gates")
    .select("trust_grade, gate_passed, quality_score")
    .eq("mission_id", missionId)
    .maybeSingle();

  if (!gate) return { gate_passed: false, trust_grade: null, quality_score: null };

  return {
    gate_passed: (gate as any).gate_passed === true,
    trust_grade: ((gate as any).trust_grade as ResearchGateSnapshot["trust_grade"]) ?? null,
    quality_score:
      typeof (gate as any).quality_score === "number"
        ? (gate as any).quality_score
        : null,
  };
}

async function loadBankerOverrides(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
): Promise<Record<string, unknown>> {
  const { data } = await (sb as any)
    .from("deal_memo_overrides")
    .select("overrides")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .maybeSingle();
  const raw = data ? (data as any).overrides : null;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

async function loadUnfinalizedRequiredDocCount(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
): Promise<number> {
  // Best-effort signal — count required checklist items missing finalized
  // satisfaction. If the table or columns differ, return 0 (warning only).
  try {
    const { count } = await (sb as any)
      .from("deal_checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("required", true)
      .neq("status", "complete");
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function loadPolicyExceptionsReviewed(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
): Promise<boolean> {
  // Open exceptions block submission. If table absent or query fails, we
  // treat the gate as satisfied (warning-only behavior — banker can still
  // review exceptions in the dedicated UI).
  try {
    const { count } = await (sb as any)
      .from("policy_exceptions")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("status", "open");
    return (count ?? 0) === 0;
  } catch {
    return true;
  }
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
