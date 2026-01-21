import type { SupabaseClient } from "@supabase/supabase-js";

export type SeedIntakePrereqsOptions = {
  dealId: string;
  bankId: string;
  source: "banker" | "builder";
  ensureBorrower?: boolean;
  ensureFinancialSnapshot?: boolean;
  setStageCollecting?: boolean;
};

export type SeedIntakePrereqsResult = {
  ok: true;
  dealId: string;
  bankId: string;
  stage: "collecting" | "intake" | "unknown";
  diagnostics: { steps: Array<{ name: string; ok: boolean; status?: string; error?: string }> };
};

const DEFAULT_LOAN_TYPE = "CRE_OWNER_OCCUPIED";

type SeedDeps = {
  sb?: SupabaseClient;
  initializeIntake?: (dealId: string, bankId?: string | null, opts?: any) => Promise<any>;
  buildChecklistForLoanType?: (loanType: string) => Array<{
    checklist_key: string;
    title: string;
    required: boolean;
    description?: string | null;
  }>;
  buildDealFinancialSnapshotForBank?: (args: any) => Promise<any>;
  computeFinancialStress?: (args: any) => any;
  evaluateSbaEligibility?: (args: any) => any;
  persistFinancialSnapshot?: (args: any) => Promise<any>;
  persistFinancialSnapshotDecision?: (args: any) => Promise<any>;
  logLedgerEvent?: (args: any) => Promise<any>;
  now?: () => string;
};

async function updateDealWithFallback(
  sb: SupabaseClient,
  dealId: string,
  payload: Record<string, any>,
) {
  const attempt = await sb.from("deals").update(payload).eq("id", dealId);
  if (!attempt.error) return;

  const msg = String(attempt.error?.message ?? "");
  if (!msg.includes("column")) {
    throw attempt.error;
  }

  const fallbackPayload: Record<string, any> = {
    borrower_id: payload.borrower_id,
    borrower_name: payload.borrower_name,
    updated_at: payload.updated_at,
    name: payload.name,
    display_name: payload.display_name,
  };

  const fallback = await sb.from("deals").update(fallbackPayload).eq("id", dealId);
  if (fallback.error) throw fallback.error;
}

export async function seedIntakePrereqsCore(
  args: SeedIntakePrereqsOptions,
  deps: SeedDeps = {},
): Promise<SeedIntakePrereqsResult> {
  const sb =
    deps.sb ?? (await import("@/lib/supabase/admin")).supabaseAdmin();
  const now = deps.now ?? (() => new Date().toISOString());

  const { dealId, bankId, source } = args;
  const ensureBorrower = args.ensureBorrower ?? false;
  const ensureFinancialSnapshot = args.ensureFinancialSnapshot ?? false;
  const setStageCollecting = args.setStageCollecting ?? false;
  let loanTypeHint: string | null = null;

  const { data: deal, error } = await sb
    .from("deals")
    .select("id, bank_id, borrower_id, borrower_name, name, display_name")
    .eq("id", dealId)
    .maybeSingle();

  if (error) {
    throw new Error(`seedIntakePrereqsCore: deal lookup failed: ${error.message}`);
  }

  if (!deal) {
    throw new Error(`seedIntakePrereqsCore: deal not found: ${dealId}`);
  }

  if (deal.bank_id && String(deal.bank_id) !== String(bankId)) {
    throw new Error("seedIntakePrereqsCore: tenant_mismatch");
  }

  const diagnostics: SeedIntakePrereqsResult["diagnostics"] = { steps: [] };
  const step = async (name: string, fn: () => Promise<string | undefined>) => {
    try {
      const status = await fn();
      diagnostics.steps.push({ name, ok: true, status });
    } catch (e: any) {
      diagnostics.steps.push({ name, ok: false, error: String(e?.message ?? e) });
    }
  };

  await step("initialize_intake", async () => {
    const initIntake =
      deps.initializeIntake ??
      (await import("@/lib/deals/intake/initializeIntake")).initializeIntake;
    const ledger =
      deps.logLedgerEvent ??
      (await import("@/lib/pipeline/logLedgerEvent")).logLedgerEvent;

    const init = await initIntake(dealId, bankId, {
      reason: `banker_intake_${source}`,
      trigger: "auto",
    });
    loanTypeHint =
      typeof (init as any)?.loanType === "string"
        ? String((init as any).loanType)
        : loanTypeHint;
    await ledger({
      dealId,
      bankId,
      eventKey: "intake.initialized",
      uiState: "done",
      uiMessage: "Intake initialized",
      meta: { source },
    });
    return "initialized";
  });

  await step("materialize_required_checklist", async () => {
    const ledger =
      deps.logLedgerEvent ??
      (await import("@/lib/pipeline/logLedgerEvent")).logLedgerEvent;

    if (!loanTypeHint) {
      const { data: intake } = await sb
        .from("deal_intake")
        .select("loan_type")
        .eq("deal_id", dealId)
        .maybeSingle();
      if (intake?.loan_type) {
        loanTypeHint = String(intake.loan_type);
      }
    }

    const loanType = String(loanTypeHint || DEFAULT_LOAN_TYPE);
    const buildChecklist =
      deps.buildChecklistForLoanType ??
      (await import("@/lib/deals/checklistPresets")).buildChecklistForLoanType;
    const requiredRows = buildChecklist(loanType as any).filter(
      (row) => row.required,
    );

    if (requiredRows.length === 0) {
      return "no_required_items";
    }

    const checklistRows = requiredRows.map((row) => {
      const next: Record<string, any> = {
        deal_id: dealId,
        checklist_key: row.checklist_key,
        title: row.title,
        description: row.description ?? null,
        required: true,
      };

      if (bankId) {
        next.bank_id = bankId;
      }

      return next;
    });

    const seed = await sb
      .from("deal_checklist_items")
      .upsert(checklistRows as any, { onConflict: "deal_id,checklist_key" });

    if (seed.error) {
      const msg = String(seed.error.message || "");
      if (msg.includes("column")) {
        const fallbackRows = checklistRows.map((row) => {
          const next = { ...row } as any;
          delete next.bank_id;
          return next;
        });
        const fallback = await sb
          .from("deal_checklist_items")
          .upsert(fallbackRows as any, { onConflict: "deal_id,checklist_key" });
        if (fallback.error) throw fallback.error;
      } else {
        throw seed.error;
      }
    }

    await ledger({
      dealId,
      bankId,
      eventKey: "deal.checklist.materialized",
      uiState: "done",
      uiMessage: `Required checklist materialized (${checklistRows.length})`,
      meta: {
        source,
        loan_type: loanType,
        item_count: checklistRows.length,
      },
    });

    return `materialized_${checklistRows.length}`;
  });

  if (ensureBorrower) {
    await step("ensure_borrower", async () => {
      if (deal.borrower_id) {
        return "already_attached";
      }

      const legalName =
        String(deal.display_name ?? deal.name ?? "Builder Seed Borrower").trim() ||
        "Builder Seed Borrower";

      const { data: borrower, error: borrowerErr } = await sb
        .from("borrowers")
        .insert({
          bank_id: bankId,
          legal_name: legalName,
          entity_type: "Unknown",
          primary_contact_name: "Builder Seed",
          primary_contact_email: `builder+${dealId.slice(0, 8)}@example.com`,
        })
        .select("id, legal_name")
        .single();

      if (borrowerErr || !borrower) {
        throw borrowerErr ?? new Error("borrower_insert_failed");
      }

      await updateDealWithFallback(sb, dealId, {
        borrower_id: borrower.id,
        borrower_name: borrower.legal_name ?? legalName,
        updated_at: now(),
      });

      return "attached";
    });
  }

  if (setStageCollecting) {
    await step("ensure_lifecycle_collecting", async () => {
      const res = await sb
        .from("deals")
        .update({ lifecycle_stage: "collecting", stage: "collecting", updated_at: now() })
        .eq("id", dealId);

      if (!res.error) {
        return "set_collecting";
      }

      const msg = String(res.error?.message ?? "");
      if (msg.includes("lifecycle_stage")) {
        const stageOnly = await sb
          .from("deals")
          .update({ stage: "collecting", updated_at: now() })
          .eq("id", dealId);

        if (!stageOnly.error) {
          return "set_collecting_stage_only";
        }

        return "column_missing";
      }

      if (msg.includes("stage")) {
        return "column_missing";
      }

      throw res.error;
    });
  }

  if (ensureFinancialSnapshot) {
    await step("ensure_financial_snapshot", async () => {
      const { count } = await sb
        .from("financial_snapshot_decisions")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .eq("bank_id", bankId);

      if (count && count > 0) {
        return "already_present";
      }

      const buildSnapshot =
        deps.buildDealFinancialSnapshotForBank ??
        (await import("@/lib/deals/financialSnapshot")).buildDealFinancialSnapshotForBank;
      const stressEngine =
        deps.computeFinancialStress ??
        (await import("@/lib/deals/financialStressEngine")).computeFinancialStress;
      const sbaEval =
        deps.evaluateSbaEligibility ??
        (await import("@/lib/sba/eligibilityEngine")).evaluateSbaEligibility;
      const persistSnapshot =
        deps.persistFinancialSnapshot ??
        (await import("@/lib/deals/financialSnapshotPersistence")).persistFinancialSnapshot;
      const persistDecision =
        deps.persistFinancialSnapshotDecision ??
        (await import("@/lib/deals/financialSnapshotPersistence"))
          .persistFinancialSnapshotDecision;

      const snapshot = await buildSnapshot({ dealId, bankId });
      const stress = stressEngine({
        snapshot,
        loanTerms: { principal: 1_000_000, amortMonths: 300, interestOnly: false, rate: 7.5 },
        stress: { vacancyUpPct: 0.1, rentDownPct: 0.1, rateUpBps: 200 },
      });
      const sba = sbaEval({
        snapshot,
        borrowerEntityType: "Unknown",
        useOfProceeds: ["working_capital"],
        dealType: null,
        loanProductType: "SBA7a",
      });
      const narrative = {
        executiveSummary: "Seed intake snapshot",
        cashFlowAnalysis: "Seed intake snapshot",
        risks: [],
        mitigants: [],
        recommendation: "Seed intake snapshot",
      };

      const snapRow = await persistSnapshot({
        dealId,
        bankId,
        snapshot,
        asOfTimestamp: now(),
      });

      if (!snapRow?.id) {
        throw new Error("snapshot_missing");
      }

      await persistDecision({
        snapshotId: snapRow.id,
        dealId,
        bankId,
        inputs: {
          snapshot,
          loanTerms: { principal: 1_000_000, amortMonths: 300, interestOnly: false, rate: 7.5 },
          stressScenario: { vacancyUpPct: 0.1, rentDownPct: 0.1, rateUpBps: 200 },
          sbaInputs: {
            borrowerEntityType: "Unknown",
            useOfProceeds: ["working_capital"],
            dealType: null,
            loanProductType: "SBA7a",
          },
        },
        stress,
        sba,
        narrative,
      });

      return "created";
    });
  }

  return {
    ok: true,
    dealId,
    bankId,
    stage: setStageCollecting ? "collecting" : "unknown",
    diagnostics,
  };
}
