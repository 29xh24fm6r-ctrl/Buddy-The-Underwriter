# Bank-Grade QA Runbook (Sebrina + Milo)

This is the manual follow-up AFTER Playwright smoke passes.

## 0) Prep
- Run public smoke:
  - `pnpm -s e2e:smoke:public`
- Run authed smoke:
  - `SMOKE_AUTH_BOOTSTRAP_URL="http://127.0.0.1:3000/admin/demo-access" pnpm -s e2e:smoke:authed`
- Start dev:
  - `pnpm -s dev`

## 1) Core Banker Workflow (Must Pass)
### A) Deals
- `/deals`
  - Loads
  - Can open a deal
  - No blank panels / no console spam

### B) Cockpit
- `/deals/<dealId>/cockpit`
  - Key actions visible (Underwrite / Pricing / Readiness)
  - No broken navigation

### C) Pricing Deal Builder (Bank-Grade)
- `/deals/<dealId>/pricing`
  - Live index rate selection (5Y Treasury / SOFR / WSJ Prime) visible
  - Inputs: amount, term, amortization, fees, spreads, etc.
  - Create quote
  - Quote history shows audit fields (who/when)
  - Explainability panel renders (why rate/spread)
  - Lock quote persists memo blocks at lock time
  - Memo Preview tab:
    - Shows committee-ready memo
    - Download PDF Appendix works
  - Committee packet contains appendix (internal packet endpoint)

### D) Readiness
- `/deals/<dealId>/readiness`
  - Checklist statuses render
  - No contradictory status vs uploads

## 2) Borrower Flow (Must Pass)
- Borrower portal entry:
  - `/borrower/<token>` (or canonical portal route)
  - Upload flows work
  - Checklist updates and guidance is clear

## 3) Underwriter Flow (Must Pass)
- `/underwrite/<dealId>`
  - Underwrite starts
  - Results render
  - No dead ends

## 4) Admin / Ops (Sanity)
- `/admin/diagnostics` (or canonical)
- `/admin/metrics` (or canonical)
- Confirm no fatal errors

## 5) Evidence of Completion
Capture:
- Screenshots of:
  - Pricing quote + locked status
  - Memo preview
  - PDF appendix downloaded
  - Committee packet showing appendix present
- Any issues logged to the canonical ledger table (if applicable)
