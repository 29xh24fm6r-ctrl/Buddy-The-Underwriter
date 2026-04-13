---
name: buddy-underwriting
version: 1.0.0
author: buddy-system
description: Financial spreads, DSCR computation, ADS, global cash flow, and risk grade
tags: [spreads, dscr, underwriting, financial-model]
allowed_tools: [supabase_read, supabase_write, gemini_flash_narrative]
---

# Underwriting Skill

## Primary surfaces
- AnalystWorkbench at /deals/[dealId]/underwrite
- Classic spread PDF (MMAS format, PDFKit)
- Structure tab at /deals/[dealId]/structure

## Spread type inventory
GLOBAL_CASH_FLOW, BALANCE_SHEET, PERSONAL_INCOME, PERSONAL_FINANCIAL_STATEMENT,
T12, RENT_ROLL

## Key output facts
CASH_FLOW_AVAILABLE, ANNUAL_DEBT_SERVICE, DSCR, DSCR_STRESSED_300BPS,
EXCESS_CASH_FLOW, TOTAL_ASSETS, TOTAL_LIABILITIES, NET_WORTH

## Entry points
- runSpreadsWorkerTick() — scheduled via Vercel cron every 2 min
- enqueueSpreadRecompute() — triggered after extraction completes
