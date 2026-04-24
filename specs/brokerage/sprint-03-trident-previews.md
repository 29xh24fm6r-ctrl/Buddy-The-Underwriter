# Sprint 3 — Trident on Borrower Portal + Preview Generation

**Status:** Specification — ready for implementation
**Depends on:** Sprint 1 (portal), Sprint 0 (score)
**Blocks:** Sprint 5 (sealing requires final trident + score)
**References:** [brokerage-master-plan.md](./brokerage-master-plan.md) §8

---

## Purpose

The trident (business plan, projections, feasibility study) is the borrower's premium value deliverable. It is released at pick. Before pick, the borrower sees watermarked, truncated previews that demonstrate quality but cannot be used outside Buddy.

This sprint:
1. Wires the existing trident generators (feasibility, projections, business plan) into the borrower portal UI so borrowers can see generation progress and preview output.
2. Builds the **preview generator** — produces watermarked, truncated PDFs on borrower fact changes.
3. Builds the **full-release generator** — runs at pick time, produces the real deliverables. (Spec here; invocation happens in Sprint 6.)

---

## What's already in place

- **Business plan:** `sbaBusinessPlanRoadmap.ts`, `sbaPackageNarrative.ts` (33KB), `sbaPackageRenderer.ts` (44KB), `sbaBorrowerPDFRenderer.ts` (37KB)
- **Projections:** `sbaForwardModelBuilder.ts`, `sbaResearchProjectionGenerator.ts` (19.5KB), `sbaBalanceSheetProjector.ts`, `sbaSourcesAndUses.ts`, `sbaAssumptionDrafter.ts` (25KB)
- **Feasibility:** full `src/lib/feasibility/` — `feasibilityEngine.ts`, `feasibilityNarrative.ts`, `feasibilityRenderer.ts` (22.8KB), four dimension analyzers
- **Orchestrator:** `sbaPackageOrchestrator.ts` (27.7KB) coordinates generation end-to-end
- **API routes:** `/api/deals/[dealId]/feasibility/{generate,latest,versions}` already live

Sprint 3 doesn't build the generators. It builds:
- A **preview mode** for each generator (watermarked + truncated output)
- A **trident bundle orchestrator** — a single entry point that generates all three in sequence or parallel
- **Portal UI** that shows progress and preview downloads

---

## Design

### Preview vs. final modes

Add a `mode: 'preview' | 'final'` parameter to each renderer. Preview mode:

**Business plan preview:**
- Render only the executive summary paragraph in full
- All other sections: section header + first paragraph only, then "[Unlocks when you pick a lender on Buddy]"
- Every page watermarked diagonally: "PREVIEW — NOT FOR DISTRIBUTION"
- Cover page includes "SAMPLE — COMPLETE DOCUMENT RELEASES AT LENDER PICK"

**Projections preview:**
- Show summary metrics only: Year 1 revenue, Year 1 DSCR, break-even month
- Detailed monthly + annual tables replaced with: blurred/redacted image of structure, row headers visible but numbers replaced with "$###,###"
- Sources & uses table: categories visible, dollar amounts rounded to nearest $10K and replaced with "$XXK"
- Sensitivity scenarios: name visible, results replaced with "—"

**Feasibility preview:**
- Overall score + four dimension scores visible in full
- One-sentence summary per dimension
- Full narrative per dimension: replaced with "[Unlocks when you pick a lender on Buddy]"
- Franchise comparator table: brand names visible, unit economics redacted

Implementation: each renderer (`sbaPackageRenderer`, `feasibilityRenderer`, projections workbook builder) adds a `mode` parameter. Default `final` for backward compat with existing bank-SaaS use. Brokerage sets `mode: 'preview'` until sealing.

### Trident bundle orchestrator

New module: `src/lib/trident/tridentBundleOrchestrator.ts`

```typescript
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateSBAPackage } from "@/lib/sba/sbaPackageOrchestrator";
import { generateFeasibilityStudy } from "@/lib/feasibility/feasibilityEngine";

export type TridentMode = "preview" | "final";

export type TridentBundle = {
  dealId: string;
  mode: TridentMode;
  businessPlanPdfPath: string | null;
  projectionsPdfPath: string | null;
  feasibilityPdfPath: string | null;
  generatedAt: string;
  version: number;
};

export async function generateTridentBundle(args: {
  dealId: string;
  mode: TridentMode;
  sb: SupabaseClient;
}): Promise<TridentBundle> {
  // 1. Ensure prerequisites: assumptions confirmed (if mode=final),
  //    validation pass not FAIL, score computed.
  // 2. Run SBA package orchestrator (produces business plan + projections + forms)
  //    with mode flag propagated to renderers.
  // 3. Run feasibility engine with mode flag.
  // 4. Persist bundle metadata to buddy_trident_bundles.
  // 5. Return bundle with PDF paths.
}
```

### Database

### Migration: `supabase/migrations/20260427_trident_bundles.sql`

```sql
CREATE TABLE IF NOT EXISTS public.buddy_trident_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  mode text NOT NULL CHECK (mode IN ('preview', 'final')),
  business_plan_pdf_path text,
  projections_pdf_path text,
  feasibility_pdf_path text,
  version integer NOT NULL DEFAULT 1,
  generated_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);

CREATE INDEX buddy_trident_bundles_deal_id_idx ON public.buddy_trident_bundles (deal_id);
CREATE INDEX buddy_trident_bundles_mode_idx ON public.buddy_trident_bundles (mode);

ALTER TABLE public.buddy_trident_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY trident_bundles_select_for_bank_members
  ON public.buddy_trident_bundles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = buddy_trident_bundles.bank_id AND m.user_id = auth.uid()
  ));
```

### Portal UI

New page section at `/portal/[token]`: "Your Package" card with three preview sub-cards:

- **Business Plan (preview)** — thumbnail, page count, "View preview" → signed URL to the preview PDF, "Full document unlocks when you pick a lender"
- **Projections (preview)** — thumbnail, Year 1 revenue range, Year 1 DSCR shown, "View preview", same unlock note
- **Feasibility (preview)** — thumbnail, overall score + four dimension scores, "View preview", same unlock note

Below the three: a status bar showing what's needed before sealing (open gap-queue items from the existing gap engine).

### API routes

- `POST /api/brokerage/deals/[dealId]/trident/preview` — trigger preview bundle generation. Returns bundle metadata.
- `GET /api/brokerage/deals/[dealId]/trident/latest-preview` — returns current preview bundle.
- `GET /api/brokerage/deals/[dealId]/trident/download/[kind]` — signed URL to preview PDF. `kind` = `business-plan | projections | feasibility`. Returns 404 if the deal is not sealed and bundle mode is not 'preview'. Returns full PDF only if the caller is the winning lender after pick (Sprint 6 enforces).

### Preview triggers

Preview generation fires on:
- Document upload completion (all three documents processed)
- Concierge turn 10+ with score ≥ 60 (enough facts for meaningful preview)
- Borrower explicit request ("Generate a preview" button in portal)

Final generation fires only on borrower pick (Sprint 6). Atomic with package release.

### Watermark + redaction implementation details

- **PDFKit diagonal watermark:** draw rotated text on every page during render.
- **Table redaction:** replace numeric cells with placeholder strings before rendering. Don't generate real values and then cover them — avoid the data ever being in the PDF at all.
- **Section truncation:** renderer takes an `includeSections` map; preview mode passes a subset.

---

## Acceptance criteria

1. `buddy_trident_bundles` table exists with RLS.
2. `tridentBundleOrchestrator` generates three PDFs (business plan, projections, feasibility) in preview mode, uploads to Supabase Storage, writes bundle row.
3. PDFs are visibly watermarked on every page. Numeric tables show placeholders, not real values. Narrative sections are truncated with unlock notes.
4. Portal shows three preview cards with metadata + download buttons.
5. Download buttons work — signed URL returns the preview PDF.
6. Regenerating the bundle supersedes prior versions (bumps `version`, sets prior `superseded_at`).
7. Final-mode generator works too (Sprint 6 invokes it). Verify by calling with `mode: 'final'` against the test deal and confirming full unwatermarked PDFs.

---

## Test plan

- **Unit:** each renderer in preview mode produces a valid PDF with correct redactions.
- **Integration:** end-to-end — populate Samaritus test deal, run preview bundle generator, open each PDF manually, confirm redactions.
- **Portal smoke:** visit `/portal/[token]`, confirm three cards render with correct metadata and working download links.
- **Regression:** existing bank-SaaS package generation (which uses `mode: 'final'` by default) still works — regenerate the Samaritus full package and verify it matches prior output.

---

## Non-goals

- Trident regeneration on every fact change (too expensive). Only on document upload completion, turn milestones, and explicit borrower request.
- Trident versioning UI — just show the latest bundle in the portal. History available via API for ops.
- Lender-facing trident access before pick. Lenders get nothing trident-related during bidding — only the Key Facts Summary.

---

## Notes for implementer

- The existing renderers are in TypeScript with PDFKit. Preview mode is a parameter change + conditional section inclusion + watermark overlay. Should be a day or two of work per renderer, not a rewrite.
- Supabase Storage paths: `trident-previews/{dealId}/{version}/{kind}.pdf` for previews, `trident-final/{dealId}/{kind}.pdf` for final (with unique version suffix if regenerated).
- Signed URL TTL: 1 hour for previews (borrower can re-request). 7 days for final (winning lender has time to download).
