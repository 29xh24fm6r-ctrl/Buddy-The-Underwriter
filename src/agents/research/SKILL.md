---
name: buddy-bie
version: 1.0.0
author: buddy-system
description: 7-thread research engine producing credit-quality borrower and industry narrative
tags: [research, bie, narrative, credit-memo]
allowed_tools: [gemini_pro_google_search_grounding]
---

# Research Skill

## Trigger
Called as part of the research pipeline, gated on deal readiness.
Entry point: runMission() in src/lib/research/runMission.ts
Model: gemini-3.1-pro-preview with Google Search grounding

## Thread inventory
1. Company background and history
2. Management qualifications
3. Industry analysis (NAICS-calibrated)
4. Market position and competitive landscape
5. SBA program eligibility analysis (SBA deals only)
6. Risk signal identification
7. Lender fit assessment

## Outputs
Writes to: buddy_research_narratives (version 3, sections JSONB array)
Writes to: buddy_research_missions (status: complete)
Feeds into: buildCanonicalCreditMemo via loadResearchForMemo

## Critical constraints
- Never use responseMimeType: "application/json" with Google Search grounding
- BIE requires hasCompany || hasNaics to fire
- Sections stored per-sentence, never concatenated blobs
