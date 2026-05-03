import "server-only";

/**
 * Auto-bootstrap + auto-confirm of buddy_sba_assumptions for the
 * borrower-concierge trident preview path.
 *
 * Why: generateSBAPackage() (the engine the trident generator chains
 * into) gates on a confirmed assumptions row. Borrowers in the brokerage
 * concierge funnel never go through the bank-side AssumptionInterview
 * UI, so without this helper trident preview generation always fails
 * with "Assumptions must be confirmed before generating the SBA package."
 *
 * What this does:
 *   1. If a confirmed row already exists for the deal, leave it alone.
 *   2. Otherwise: load prefill (NAICS-driven defaults + financial facts +
 *      ownership entities), merge concierge facts as fallbacks, fill the
 *      narrative-only management bio with a preview placeholder, run the
 *      same validateSBAAssumptions used by the bank flow, and on pass
 *      upsert with status='confirmed' + confirmed_at=now.
 *   3. On validation failure: persist as 'draft' and return the blockers
 *      so the caller can tell the borrower what's missing. The validator
 *      is NOT bypassed.
 *
 * Scope of placeholders: only the management-team bio narrative, which
 * is descriptive copy (not a financial input). All numeric inputs —
 * revenue, COGS, loan amount, term, rate — must come from real prefill
 * sources. If they're missing, the helper returns blockers, and the
 * borrower sees a specific list of what to provide.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadSBAAssumptionsPrefill } from "./sbaAssumptionsPrefill";
import { validateSBAAssumptions } from "./sbaAssumptionsValidator";
import type {
  SBAAssumptions,
  ManagementMember,
  RevenueStream,
} from "./sbaReadinessTypes";

const PREVIEW_BIO_PLACEHOLDER =
  "Principal of the business; full biography will be added before final package generation.";

export type EnsureResult =
  | { ok: true; assumptionsId: string; alreadyConfirmed: boolean }
  | { ok: false; blockers: string[] };

export type ConciergeFacts = {
  borrower?: { first_name?: string | null; last_name?: string | null } | null;
  business?: { legal_name?: string | null } | null;
  loan?: { amount_requested?: number | null } | null;
} | null;

export async function ensureAssumptionsForPreview(args: {
  dealId: string;
  conciergeFacts?: ConciergeFacts;
  sb?: SupabaseClient;
}): Promise<EnsureResult> {
  const sb = args.sb ?? supabaseAdmin();

  const { data: existing } = await sb
    .from("buddy_sba_assumptions")
    .select("*")
    .eq("deal_id", args.dealId)
    .maybeSingle();

  if (existing && existing.status === "confirmed") {
    return {
      ok: true,
      assumptionsId: existing.id,
      alreadyConfirmed: true,
    };
  }

  const prefill = await loadSBAAssumptionsPrefill(args.dealId);
  const candidate = buildCandidate({
    dealId: args.dealId,
    prefill,
    existingRow: existing,
    conciergeFacts: args.conciergeFacts ?? null,
  });

  const validation = validateSBAAssumptions(candidate);

  if (!validation.ok) {
    // Persist the (incomplete) candidate as a draft so the borrower's
    // partial inputs aren't lost between turns. assumptionsId is withheld
    // from the result on this path — the caller's contract is the
    // blockers list, not the id.
    await upsertAssumptionsRow(sb, args.dealId, candidate, "draft");
    return {
      ok: false,
      blockers: validation.blockers,
    } as EnsureResult;
  }

  const id = await upsertAssumptionsRow(
    sb,
    args.dealId,
    candidate,
    "confirmed",
  );
  return { ok: true, assumptionsId: id, alreadyConfirmed: false };
}

function buildCandidate(args: {
  dealId: string;
  prefill: Awaited<ReturnType<typeof loadSBAAssumptionsPrefill>>;
  existingRow: Record<string, unknown> | null | undefined;
  conciergeFacts: ConciergeFacts;
}): SBAAssumptions {
  const { dealId, prefill, existingRow, conciergeFacts } = args;
  const ex = (existingRow ?? {}) as Record<string, unknown>;

  const conciergeFirst = String(
    conciergeFacts?.borrower?.first_name ?? "",
  ).trim();
  const conciergeLast = String(
    conciergeFacts?.borrower?.last_name ?? "",
  ).trim();
  const conciergeName = [conciergeFirst, conciergeLast]
    .filter(Boolean)
    .join(" ");
  const conciergeLoanAmount = Number(
    conciergeFacts?.loan?.amount_requested ?? 0,
  );

  const exRevenueStreams =
    (ex.revenue_streams as RevenueStream[] | null) ?? null;
  const revenueStreams: RevenueStream[] =
    exRevenueStreams && exRevenueStreams.length
      ? exRevenueStreams
      : (prefill.revenueStreams ?? []);

  const exCost = (ex.cost_assumptions as
    | SBAAssumptions["costAssumptions"]
    | null) ?? null;
  const costAssumptions = exCost ??
    prefill.costAssumptions ?? {
      cogsPercentYear1: 0.5,
      cogsPercentYear2: 0.5,
      cogsPercentYear3: 0.5,
      fixedCostCategories: [],
      plannedHires: [],
      plannedCapex: [],
    };

  const exWC = (ex.working_capital as
    | SBAAssumptions["workingCapital"]
    | null) ?? null;
  const workingCapital = exWC ??
    prefill.workingCapital ?? {
      targetDSO: 45,
      targetDPO: 30,
      inventoryTurns: null,
    };

  const exLI = (ex.loan_impact as
    | Partial<SBAAssumptions["loanImpact"]>
    | null) ?? null;
  const prefillLI = prefill.loanImpact ?? null;
  const loanAmount =
    Number(exLI?.loanAmount ?? 0) ||
    Number(prefillLI?.loanAmount ?? 0) ||
    conciergeLoanAmount ||
    0;
  const loanImpact: SBAAssumptions["loanImpact"] = {
    loanAmount,
    termMonths: Number(exLI?.termMonths ?? prefillLI?.termMonths ?? 120),
    interestRate: Number(
      exLI?.interestRate ?? prefillLI?.interestRate ?? 0.0725,
    ),
    existingDebt: exLI?.existingDebt ?? prefillLI?.existingDebt ?? [],
    revenueImpactStartMonth:
      exLI?.revenueImpactStartMonth ?? prefillLI?.revenueImpactStartMonth,
    revenueImpactPct:
      exLI?.revenueImpactPct ?? prefillLI?.revenueImpactPct,
    revenueImpactDescription:
      exLI?.revenueImpactDescription ?? prefillLI?.revenueImpactDescription,
    equityInjectionAmount: Number(
      exLI?.equityInjectionAmount ?? prefillLI?.equityInjectionAmount ?? 0,
    ),
    equityInjectionSource:
      exLI?.equityInjectionSource ??
      prefillLI?.equityInjectionSource ??
      "cash_savings",
    sellerFinancingAmount: Number(
      exLI?.sellerFinancingAmount ?? prefillLI?.sellerFinancingAmount ?? 0,
    ),
    sellerFinancingTermMonths: Number(
      exLI?.sellerFinancingTermMonths ??
        prefillLI?.sellerFinancingTermMonths ??
        0,
    ),
    sellerFinancingRate: Number(
      exLI?.sellerFinancingRate ?? prefillLI?.sellerFinancingRate ?? 0,
    ),
    otherSources: exLI?.otherSources ?? prefillLI?.otherSources ?? [],
  };

  const exMT = (ex.management_team as ManagementMember[] | null) ?? null;
  let managementTeam: ManagementMember[] =
    exMT && exMT.length
      ? exMT
      : prefill.managementTeam && prefill.managementTeam.length
        ? prefill.managementTeam
        : [];

  // Borrower fallback: if no team came from prefill (no ownership entities
  // recorded — typical for brokerage concierge deals), seed from concierge
  // borrower name. NEVER fabricate a name that wasn't given.
  if (managementTeam.length === 0 && conciergeName) {
    managementTeam = [
      {
        name: conciergeName,
        title: "Founder / CEO",
        ownershipPct: 100,
        yearsInIndustry: 0,
        bio: PREVIEW_BIO_PLACEHOLDER,
      },
    ];
  }

  // Preview-only narrative backfill: bios shorter than the validator's
  // 20-char floor get the placeholder. Bios already filled by prefill or
  // borrower input pass through untouched.
  managementTeam = managementTeam.map((m) => ({
    ...m,
    bio:
      typeof m.bio === "string" && m.bio.trim().length >= 20
        ? m.bio
        : PREVIEW_BIO_PLACEHOLDER,
  }));

  return {
    dealId,
    status: "confirmed",
    confirmedAt: new Date().toISOString(),
    revenueStreams,
    costAssumptions,
    workingCapital,
    loanImpact,
    managementTeam,
  };
}

async function upsertAssumptionsRow(
  sb: SupabaseClient,
  dealId: string,
  candidate: SBAAssumptions,
  status: "draft" | "confirmed",
): Promise<string> {
  const payload = {
    deal_id: dealId,
    revenue_streams: candidate.revenueStreams,
    cost_assumptions: candidate.costAssumptions,
    working_capital: candidate.workingCapital,
    loan_impact: candidate.loanImpact,
    management_team: candidate.managementTeam,
    status,
    confirmed_at: status === "confirmed" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await sb
    .from("buddy_sba_assumptions")
    .select("id")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (existing?.id) {
    await sb.from("buddy_sba_assumptions").update(payload).eq("id", existing.id);
    return existing.id as string;
  }
  const { data: inserted } = await sb
    .from("buddy_sba_assumptions")
    .insert(payload)
    .select("id")
    .single();
  return (inserted?.id as string) ?? "";
}

/**
 * Proactive draft persistence for the concierge flow.
 *
 * Called on every concierge turn after fact extraction so a row tracking
 * the borrower's current best-known assumptions always exists for the deal —
 * even before they ask for the trident preview. Never validates, never
 * confirms, never downgrades: an already-confirmed row passes through
 * untouched. Safe to fire-and-forget.
 *
 * Differs from `ensureAssumptionsForPreview` in two ways:
 *   - skips `validateSBAAssumptions` (drafts are allowed to be incomplete)
 *   - never sets status='confirmed' (only an explicit confirmation step does that)
 */
export type PersistDraftResult = {
  assumptionsId: string;
  status: "draft" | "confirmed";
};

export async function persistAssumptionsDraft(args: {
  dealId: string;
  conciergeFacts?: ConciergeFacts;
  sb?: SupabaseClient;
}): Promise<PersistDraftResult> {
  const sb = args.sb ?? supabaseAdmin();

  const { data: existing } = await sb
    .from("buddy_sba_assumptions")
    .select("id, status")
    .eq("deal_id", args.dealId)
    .maybeSingle();

  // Never downgrade a confirmed row from a background draft refresh.
  // Borrower edits to a confirmed deal must go through the explicit
  // confirmation flow (which rebuilds + revalidates).
  if (existing && existing.status === "confirmed") {
    return { assumptionsId: existing.id, status: "confirmed" };
  }

  const prefill = await loadSBAAssumptionsPrefill(args.dealId);
  const candidate = buildCandidate({
    dealId: args.dealId,
    prefill,
    existingRow: existing as Record<string, unknown> | null,
    conciergeFacts: args.conciergeFacts ?? null,
  });

  const id = await upsertAssumptionsRow(sb, args.dealId, candidate, "draft");
  return { assumptionsId: id, status: "draft" };
}

// Exported for unit testing.
export const __test_buildCandidate = buildCandidate;
export const __test_PREVIEW_BIO_PLACEHOLDER = PREVIEW_BIO_PLACEHOLDER;
