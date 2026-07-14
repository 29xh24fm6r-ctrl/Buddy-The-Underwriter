# Follow-up ticket — Existing Business Debt Capture (debt schedule wiring)

**Filed:** 2026-07-14, out of SPEC-BROKERAGE-SBA-READY-V1 Ticket 0 (see `docs/archive/brokerage-sba-ready-v1/T0-findings.md`, item 3).
**Priority: P0. Sequenced ahead of Ticket 2 (identity/e-sign)** — product decision 2026-07-14: a deal cannot be underwritten correctly without a complete existing-debt schedule, regardless of how polished the signing ceremony is. Do this before Ticket 2, not after.
**Depends on:** none blocking, but item 1 below must be answered before scoping the rest.

---

## Context

T0 went looking for the "equity seasoning + debt schedule auto-builder" the roadmap's Phase 3 (S4) entry mentions, expecting it to be document-extraction-driven (OCR off uploaded bank statements). It's real and tested, but not what was assumed:

- `src/lib/financialFacts/debtScheduleAutoBuilder.ts` exports `buildDebtSchedule(transactions: BorrowerBankTransactionLike[])` — a pure function that infers existing debt obligations (mortgage/credit-card/MCA/etc.) from **Plaid bank-transaction data**, per `specs/sba-30min-package/SPEC-S4-credit-pull-and-irs.md`. Fully unit-tested (6 cases).
- **It has zero callers anywhere in the codebase outside its own test file.** Not in a route, not in a job processor, not in the Brokerage concierge, not in any Underwriter cockpit flow.
- `src/app/api/deals/[dealId]/existing-debt/route.ts` provides GET/POST against a `deal_existing_debt_schedule` table, but it's gated by `ensureDealBankAccess` — a banker-side manual-entry API for the Underwriter cockpit, unreachable by a Brokerage borrower.
- `BORROWER_FIELD_REGISTRY` has no `existing_debt`/`debt_schedule` entries at all, and the concierge extraction prompt doesn't ask about it.

**Net: this is not "Brokerage is missing a field." No path anywhere in this product — Brokerage or Underwriter, conversational, Plaid-driven, or manual-by-borrower — gets a borrower's existing business debt into the system.** SBA underwriting requires a full existing-debt schedule (not just the debt being refinanced) for DSCR/global-cash-flow purposes. Every deal that's gone through this product to date has had this gap.

## Scope

1. **Open question to resolve first:** does Brokerage have a live Plaid connection today? T0 did not confirm this — check `src/app/(borrower)/` and `src/lib/brokerage/` for any Plaid Link integration. If Brokerage has no Plaid connection at all, standing up one is in scope for this ticket (it's a prerequisite `buildDebtSchedule` needs input from), not a separate ticket to wait on.
2. **Wire `buildDebtSchedule()` to run against real Plaid transactions** for a Brokerage deal, at whatever point in the funnel Plaid Link completes (or as a background job once transactions are available). It's a pure function — the wiring gap is entirely "nobody calls it with real data," not "the logic is wrong."
3. **Persist auto-built entries into `deal_existing_debt_schedule`** — the same table the banker-facing manual-entry route already reads/writes — so both the new automated path and the existing manual path converge on one source of truth rather than becoming a second parallel debt-schedule store.
4. **Structured fallback capture** for borrowers without a Plaid connection, or where `buildDebtSchedule`'s inferred confidence is low (the auto-builder already returns a confidence score per its test suite — "insufficient history -> confidence < 0.5" is one of its 6 cases). This should land as part of Ticket 3's structured-fallback-capture work if Ticket 3 is in flight, or as a standalone targeted form screen if not — not a full flow redesign either way.
5. **Confirm downstream consumers actually read the resulting schedule.** Check `src/lib/structuralPricing/computeTotalDebtService.ts` and the global-cash-flow calculation path — do they currently read from `deal_existing_debt_schedule` at all, or from some other/no source? If they don't read it, wiring the capture side without wiring the consumption side leaves DSCR/global-cash-flow still blind to existing debt. This may turn out to be two ticket-sized pieces of work rather than one; scope accordingly once this is checked.

## Verification

- Synthetic deal with Plaid transactions showing a mortgage payment, a recurring credit-card payment, and an MCA daily remittance → `deal_existing_debt_schedule` gets three correctly-categorized entries via the auto-builder, matching `buildDebtSchedule`'s own test expectations.
- Synthetic deal with no Plaid connection → borrower is routed through the structured fallback capture and produces rows in the same table shape.
- Confirm DSCR and/or global-cash-flow output for both synthetic deals changes to reflect the captured debt — not silently unaffected because a downstream consumer never reads this table.
- No regression to the existing banker-side manual-entry route (`existing-debt/route.ts`) — it should still work standalone and should see the same rows the automated path writes.
