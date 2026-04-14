# Buddy The Underwriter — Hotfix Log

## 2026-04-14

- fix: `launched_by uuid` → `text` in `underwriting_launch_snapshots` + `underwriting_workspaces` (DB migration)
- fix: workspace `status: "active"` → `"in_progress"` (satisfies `uw_workspaces_status_ck`)
- fix: credit memo validation gate — treat absent `buddy_validation_reports` as unrun, not blocked
- fix: `deal_financial_facts.period_end` → `fact_period_end` (correct column name)
