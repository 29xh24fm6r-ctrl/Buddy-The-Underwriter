# Business model evidence scope

Live verification of PR1125 reached the no-AI check and exposed a deterministic blocker before any paid generation. Three years of the QA owner's `PERSONAL_INCOME` / `PERSONAL_TAX_RETURN` facts entered Model Engine V2 as the unopened business's historical net income. The startup guard then correctly rejected the resulting contradictory model, but the model input scope was wrong.

The authoritative deal business model now shares the existing Classic Spread `isBusinessStatementFact` policy. Personal owner facts and personal-return source types are excluded from its historical model; an explicit `PERSONAL_INCOME` fact type also excludes incomplete legacy ownership metadata. Source facts remain intact and available to personal-income and guarantor/global-cash-flow readers. Business statements and unambiguous legacy business facts keep their existing behavior. No values, ownership records, acceptance rules, or quality thresholds change.

Package financial snapshot version advances to `model_v2_package_4` so corrected runs cannot reuse a cached financial output computed with the old scope. The borrower receives a specific business-stage correction message if genuine operating history still conflicts with a preparing-to-open answer.

The package computation tests now execute the real authoritative engine instead of stubbing it. Regressions cover an opening balance sheet plus three years of personal taxes, personal-return sources incorrectly tagged as DEAL, personal balance sheets, personal-income facts without ownership metadata, unchanged established-business metrics, and the existing genuine operating-history conflict guard. No AI calls or production financial-data writes are needed for these checks.

The real-engine tests also exposed an unconditional system-event insert during `persist: false` computation. Read-only previews now suppress that telemetry write along with snapshot and spread persistence. Persisted computation retains the served event.

Local verification: 3,900 token-free regressions passed with network access disabled, plus 24 Classic Spread scope/wiring tests. Snapshot tests verify that the previous model version is rejected and recomputed. A replay of the QA application's 41 accepted facts retains all 24 personal facts in the source set while producing only the September 21 opening business balance sheet, with $250,000 cash/assets/equity and no business income history. TypeScript checks passed. Live generated documents and final release remain unverified.
