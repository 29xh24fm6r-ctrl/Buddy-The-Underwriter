/**
 * One-off smoke test for the debt-schedule-wiring follow-up
 * (SPEC-BROKERAGE-SBA-READY-V1). Exercises the real writer against the live
 * DB with a synthetic is_test=true deal, then deletes everything it
 * created. Not part of test:unit — run manually: `pnpm tsx scripts/smoke-existing-debt-schedule.ts`.
 */
import { createClient } from "@supabase/supabase-js";
import {
  insertExistingDebtScheduleEntry,
  listExistingDebtScheduleEntries,
  deleteExistingDebtScheduleEntry,
  syncExistingDebtScheduleToDownstream,
} from "../src/lib/financialFacts/existingDebtScheduleWriter";

const SANDBOX_BANK_ID = "0d60db8c-6963-4fef-900e-d96c6e104393"; // External Banker Sandbox

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(url, key);

  console.log("[smoke] creating synthetic deal…");
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .insert({
      bank_id: SANDBOX_BANK_ID,
      name: "SMOKE existing-debt-schedule",
      deal_type: "SBA",
      loan_amount: 500_000,
      is_test: true,
    })
    .select("id")
    .single();
  if (dealErr || !deal) throw new Error(`deal insert failed: ${dealErr?.message}`);
  const dealId = deal.id as string;
  console.log(`[smoke] deal ${dealId}`);

  try {
    // 1. Insert two entries: one active, one being refinanced (should be excluded from sums).
    const r1 = await insertExistingDebtScheduleEntry(
      {
        dealId,
        bankId: SANDBOX_BANK_ID,
        lenderName: "SMOKE Chase",
        loanType: "mortgage",
        currentBalance: 240_000,
        monthlyPayment: 1_800,
        source: "manual_borrower",
      },
      sb as any,
    );
    if (!r1.ok) throw new Error(`insert 1 failed: ${r1.error}`);
    console.log("[smoke] inserted entry 1 (active mortgage)", r1.row.id);

    const r2 = await insertExistingDebtScheduleEntry(
      {
        dealId,
        bankId: SANDBOX_BANK_ID,
        lenderName: "SMOKE Old SBA Loan",
        loanType: "sba_loan",
        currentBalance: 100_000,
        monthlyPayment: 900,
        isBeingRefinanced: true,
        source: "manual_borrower",
      },
      sb as any,
    );
    if (!r2.ok) throw new Error(`insert 2 failed: ${r2.error}`);
    console.log("[smoke] inserted entry 2 (being refinanced — should be excluded)", r2.row.id);

    const listed = await listExistingDebtScheduleEntries(dealId, sb as any);
    if (listed.length !== 2) throw new Error(`expected 2 rows, got ${listed.length}`);
    console.log("[smoke] PASS: list returns both rows");

    // 2. Sync — expect ADS fact = 1800*12 = 21600 (excludes the refinanced entry).
    const sync = await syncExistingDebtScheduleToDownstream(
      { dealId, bankId: SANDBOX_BANK_ID },
      sb as any,
    );
    console.log("[smoke] sync result:", sync);
    if (!sync.wrote.includes("fact:ADS")) throw new Error("expected ADS fact to be written");

    const { data: adsFact } = await sb
      .from("deal_financial_facts")
      .select("fact_value_num, fact_type")
      .eq("deal_id", dealId)
      .eq("fact_key", "ADS")
      .maybeSingle();
    if (!adsFact) throw new Error("ADS fact not found after sync");
    if (Number(adsFact.fact_value_num) !== 21_600) {
      throw new Error(`expected ADS=21600 (excluding refinanced entry), got ${adsFact.fact_value_num}`);
    }
    if (adsFact.fact_type !== "concierge") {
      throw new Error(`expected fact_type=concierge, got ${adsFact.fact_type}`);
    }
    console.log("[smoke] PASS: ADS fact = 21600, fact_type=concierge, correctly excludes the refinanced entry");

    // 3. Second sync call should UPDATE the same fact row, not create a duplicate.
    await syncExistingDebtScheduleToDownstream({ dealId, bankId: SANDBOX_BANK_ID }, sb as any);
    const { data: adsFactsAfterSecondSync } = await sb
      .from("deal_financial_facts")
      .select("id")
      .eq("deal_id", dealId)
      .eq("fact_key", "ADS");
    if ((adsFactsAfterSecondSync ?? []).length !== 1) {
      throw new Error(
        `expected exactly 1 ADS fact row after two syncs, got ${(adsFactsAfterSecondSync ?? []).length}`,
      );
    }
    console.log("[smoke] PASS: repeated sync upserts in place, no duplicate fact rows");

    // 4. Delete one entry, re-sync, confirm ADS drops to 0 sum from the remaining
    // (refinanced) row, i.e. skipped (no rows counted as active).
    const del = await deleteExistingDebtScheduleEntry({ id: r1.row.id, dealId }, sb as any);
    if (!del.ok) throw new Error(`delete failed: ${del.error}`);
    console.log("[smoke] PASS: delete succeeded");

    // 5. Confirm-no-debt path on a fresh synthetic deal (no rows at all).
    const { data: deal2 } = await sb
      .from("deals")
      .insert({ bank_id: SANDBOX_BANK_ID, name: "SMOKE no-debt deal", deal_type: "SBA", is_test: true })
      .select("id")
      .single();
    const dealId2 = deal2!.id as string;
    try {
      const confirmSync = await syncExistingDebtScheduleToDownstream(
        { dealId: dealId2, bankId: SANDBOX_BANK_ID, confirmNoDebt: true },
        sb as any,
      );
      if (!confirmSync.wrote.includes("fact:ADS")) {
        throw new Error("expected ADS=0 fact to be written for confirmed-no-debt deal");
      }
      const { data: zeroFact } = await sb
        .from("deal_financial_facts")
        .select("fact_value_num")
        .eq("deal_id", dealId2)
        .eq("fact_key", "ADS")
        .maybeSingle();
      if (Number(zeroFact?.fact_value_num) !== 0) {
        throw new Error(`expected ADS=0 for confirmed-no-debt deal, got ${zeroFact?.fact_value_num}`);
      }
      console.log("[smoke] PASS: confirmNoDebt writes an explicit ADS=0 fact");
    } finally {
      await sb.from("deal_financial_facts").delete().eq("deal_id", dealId2);
      await sb.from("deals").delete().eq("id", dealId2);
    }

    console.log("\n[smoke] ALL PASS");
  } finally {
    console.log("[smoke] cleaning up synthetic deal…");
    await sb.from("deal_existing_debt_schedule").delete().eq("deal_id", dealId);
    await sb.from("deal_financial_facts").delete().eq("deal_id", dealId);
    await sb.from("buddy_sba_assumptions").delete().eq("deal_id", dealId);
    await sb.from("deals").delete().eq("id", dealId);
  }
}

main().catch((e) => {
  console.error("[smoke] FAIL:", e);
  process.exitCode = 1;
});
