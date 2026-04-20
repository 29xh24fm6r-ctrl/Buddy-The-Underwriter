# Phase 82 — Joint Filer Intelligence + Borrower Message Fix

**Status:** Spec ready for implementation  
**Scope:** 1 UI text fix + 4-layer joint filer intelligence system  
**Why this matters:** ~40% of small business guarantor pairs are married co-owners who file jointly.
Requiring them to submit separate PTRs and PFS documents is wrong, creates unnecessary friction,
and signals Buddy doesn't understand basic lending practice. A joint 1040 MFJ legally covers
both spouses. One set of documents is correct.

---

## Part 0 — Immediate UI Fix (do this first, 2 minutes)

### File: `src/components/deals/DealCockpitClient.tsx`

Find the `CockpitBorrowerIdentity` function. It currently renders:

```tsx
<span className="text-xs text-red-400 font-medium">
  Borrower data unavailable — contact support
</span>
```

Replace with:

```tsx
<span className="text-xs text-white/30 font-medium">
  Borrower not yet linked
</span>
```

**Why:** "Borrower not yet linked" is the accurate description of a deal that hasn't had a
borrower entity attached yet. This is a normal, temporary state during intake. Red text and
"contact support" language creates a false crisis for a routine condition. The borrower
auto-links once document processing completes OR the banker manually links it via the
Borrower tab.

---

## Part 1 — Architecture Overview

The joint filer system requires 4 layers. Implement them in order.

```
Layer 1: Detection  →  Layer 2: Schema  →  Layer 3: UI  →  Layer 4: Checklist
(extraction)           (migration)          (intake banner)   (satisfaction)
```

### Key Files Involved

| Layer | File(s) |
|-------|---------|
| 1 — Detection | `src/lib/financialSpreads/extractors/deterministic/personalIncomeDeterministic.ts` |
| 1 — Detection | `src/lib/financialSpreads/extractors/deterministic/pfsDeterministic.ts` |
| 1 — Detection | `src/lib/financialFacts/keys.ts` (add 4 new fact keys) |
| 2 — Schema | New migration: `supabase/migrations/20260416000000_joint_filer_entity_binding.sql` |
| 3 — UI | `src/components/deals/intake/IntakeReviewTable.tsx` |
| 3 — UI | New API route: `src/app/api/deals/[dealId]/intake/documents/[documentId]/joint-bind/route.ts` |
| 4 — Checklist | `src/lib/checklist/engine.ts` |

---

## Part 2 — Layer 1: Detection (Fact Key Extraction)

### 2a — Add 4 new fact keys

In `src/lib/financialFacts/keys.ts`, add these four keys to the appropriate enums/sets:

```typescript
// Joint filer detection keys — personal income (1040)
"PTR_FILING_STATUS",       // "MFJ" | "MFS" | "SINGLE" | "HOH" | "QW"
"PTR_SPOUSE_NAME",         // co-filer name extracted from Form 1040 spouse line

// Joint PFS detection keys
"PFS_IS_JOINT",            // "true" | "false" — two signatories at same address
"PFS_CO_APPLICANT_NAME",   // second signatory name on joint PFS
```

These are string facts (not numeric). They go wherever string-valued personal facts
are defined. If there is a `PERSONAL_INCOME_FACT_KEYS` set or similar, add them there.

### 2b — Enhance `personalIncomeDeterministic.ts`

This extractor currently processes Form 1040 income lines but ignores filing status entirely.

**Add to `VALID_LINE_KEYS` set:**
```typescript
"PTR_FILING_STATUS",
"PTR_SPOUSE_NAME",
```

**Add to `LABEL_PATTERNS` array:**
```typescript
{
  key: "PTR_FILING_STATUS",
  // Form 1040 filing status checkboxes: Line 1 = Single, Line 2 = MFJ, Line 3 = MFS, etc.
  // OCR of checkboxes varies wildly — match "married filing jointly" text label or checked box context
  pattern: /(?:filing\s+status|line\s+[12345])\s*(?:\[.{0,3}\]|✓|✗|x|■)?\s*(single|married\s+filing\s+jointly|married\s+filing\s+separately|head\s+of\s+household|qualifying\s+(?:widow|surviving\s+spouse))/i,
},
{
  key: "PTR_SPOUSE_NAME",
  // Spouse's name as it appears on 1040 — "If joint return, spouse's first name and middle initial"
  pattern: /(?:spouse(?:'s)?\s+(?:first\s+)?name|if\s+joint\s+return)[,:\s]+([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/i,
},
```

**Add to `ENTITY_MAP`:**
```typescript
filing_status: "PTR_FILING_STATUS",
ptr_filing_status: "PTR_FILING_STATUS",
spouse_name: "PTR_SPOUSE_NAME",
ptr_spouse_name: "PTR_SPOUSE_NAME",
```

**Critical:** The filing status extraction is string-valued, not numeric. The existing
`writeFactsBatch` / `ExtractedLineItem` types store numeric values. You need to handle
this correctly. Two options:

**Option A (preferred):** Use `fact_value_text` column instead of `fact_value_num`.
Write a separate `writeStringFactsBatch` call (or extend `writeFactsBatch` to accept
string values) for these two keys after the numeric extraction.

**Option B (acceptable):** Encode MFJ as a sentinel numeric value (MFJ=1, SINGLE=2, etc.)
and store in `fact_value_num`. Less readable but simpler.

Choose Option A if `fact_value_text` already exists in `deal_financial_facts`. Check the
schema before implementing.

**MFJ detection shortcut:** Also add a direct pattern for the common OCR output of MFJ checkboxes:
```typescript
// Common OCR output when "Married filing jointly" checkbox is checked
/\bmarried\s+filing\s+jointly\b/i
```
If this pattern matches anywhere in the first 3 pages, write `PTR_FILING_STATUS = "MFJ"` with
confidence 0.90, no secondary patterns required.

### 2c — Enhance `pfsDeterministic.ts`

**Add to `VALID_LINE_KEYS` set:**
```typescript
"PFS_IS_JOINT",
"PFS_CO_APPLICANT_NAME",
```

**Add joint signatory detection after the main extraction loop:**

```typescript
// Joint PFS detection — look for second signatory in signature block
// OGB PFS form: "Co-Applicant Name", "Joint Applicant", or two signature lines
function detectJointPfs(ocrText: string): { isJoint: boolean; coApplicantName: string | null } {
  const coApplicantPatterns = [
    /co[\s-]?applicant(?:'s)?\s+(?:name|signature)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    /joint\s+applicant[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    /(?:and|&)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*(?:\(spouse\)|co-?applicant)/i,
    // Two signature lines with names — look for second "Print Name:" or "Printed Name:"
    /print(?:ed)?\s+name[:\s]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+[\s\S]{0,200}print(?:ed)?\s+name[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
  ];

  for (const pattern of coApplicantPatterns) {
    const match = ocrText.match(pattern);
    if (match?.[1]) {
      return { isJoint: true, coApplicantName: match[1].trim() };
    }
  }

  return { isJoint: false, coApplicantName: null };
}
```

Call this function and write the results as string facts after the main numeric extraction.

---

## Part 3 — Layer 2: Schema Migration

### New file: `supabase/migrations/20260416000000_joint_filer_entity_binding.sql`

```sql
-- Phase 82: Joint Filer Entity Binding
--
-- Adds subject_ids (UUID array) to deal_documents so a single document
-- (joint 1040 MFJ, joint PFS) can be bound to multiple guarantor entities.
--
-- Backward compat: subject_id (single UUID) is preserved unchanged.
-- All existing code continues working. New joint-binding code writes subject_ids.
-- When subject_ids is populated, it takes precedence over subject_id for
-- joint satisfaction checks. subject_id remains the primary entity for
-- single-entity documents and backward-compatible queries.

-- Step 1: Add subject_ids array column (nullable, preserves existing rows)
ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS subject_ids UUID[] DEFAULT NULL;

-- Step 2: Add joint filer metadata columns
ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS joint_filer_confirmed BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS joint_filer_confirmed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS joint_filer_confirmed_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS joint_filer_detection_source TEXT DEFAULT NULL;
  -- joint_filer_detection_source values:
  -- "auto_mfj"       — detected MFJ checkbox on Form 1040
  -- "auto_joint_pfs" — detected two signatories on PFS
  -- "banker_confirmed" — banker explicitly confirmed via intake UI
  -- "banker_denied"    — banker explicitly denied via intake UI

-- Step 3: Backfill subject_ids from subject_id for existing single-entity docs
UPDATE public.deal_documents
SET subject_ids = ARRAY[subject_id]
WHERE subject_id IS NOT NULL
  AND subject_ids IS NULL;

-- Step 4: Index for efficient entity-based queries
CREATE INDEX IF NOT EXISTS idx_deal_documents_subject_ids
  ON public.deal_documents USING GIN (subject_ids)
  WHERE subject_ids IS NOT NULL;

-- Step 5: Convenience view for joint document queries
CREATE OR REPLACE VIEW public.deal_documents_with_entities AS
SELECT
  dd.*,
  -- Canonical entity ID: subject_ids[1] if joint, else subject_id
  COALESCE(subject_ids[1], subject_id) AS primary_subject_id,
  -- Is this a joint document?
  (array_length(subject_ids, 1) > 1 OR joint_filer_confirmed = true) AS is_joint_document,
  -- Count of bound entities
  COALESCE(array_length(subject_ids, 1), CASE WHEN subject_id IS NOT NULL THEN 1 ELSE 0 END) AS entity_count
FROM public.deal_documents dd;

-- Grant access
GRANT SELECT ON public.deal_documents_with_entities TO authenticated;
GRANT SELECT ON public.deal_documents_with_entities TO service_role;
```

**Apply this migration via `supabase db push` before implementing Layers 3 and 4.**

---

## Part 4 — Layer 3: Intake UI — Joint Filer Detection Banner

### 4a — New API route: joint-bind

**New file:** `src/app/api/deals/[dealId]/intake/documents/[documentId]/joint-bind/route.ts`

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const BodySchema = z.object({
  // Array of entity IDs this document covers (2 for joint, 1 to revert to single)
  subject_ids: z.array(z.string().uuid()).min(1).max(2),
  // Whether banker explicitly confirmed this as a joint filing
  confirmed: z.boolean(),
  detection_source: z.enum(["auto_mfj", "auto_joint_pfs", "banker_confirmed", "banker_denied"]).optional(),
});

type Ctx = { params: Promise<{ dealId: string; documentId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId, documentId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await req.json());
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const now = new Date().toISOString();

    const patch: Record<string, unknown> = {
      subject_ids: body.subject_ids,
      // Keep subject_id in sync with first entity for backward compat
      subject_id: body.subject_ids[0],
      joint_filer_confirmed: body.confirmed,
      joint_filer_confirmed_at: now,
      joint_filer_confirmed_by: access.userId,
      joint_filer_detection_source: body.detection_source ?? "banker_confirmed",
    };

    const { error: updErr } = await (sb as any)
      .from("deal_documents")
      .update(patch)
      .eq("id", documentId)
      .eq("deal_id", dealId);

    if (updErr) {
      return NextResponse.json(
        { ok: false, error: "update_failed", detail: updErr.message },
        { status: 500 }
      );
    }

    void writeEvent({
      dealId,
      kind: body.confirmed
        ? "intake.document_joint_binding_confirmed"
        : "intake.document_joint_binding_denied",
      actorUserId: access.userId,
      scope: "intake",
      meta: {
        document_id: documentId,
        subject_ids: body.subject_ids,
        detection_source: body.detection_source,
        confirmed: body.confirmed,
      },
    });

    return NextResponse.json({ ok: true, documentId, subject_ids: body.subject_ids });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
```

### 4b — Joint filer banner in `IntakeReviewTable.tsx`

**Context:** The intake review table already fetches `/api/deals/[dealId]/intake/review`
which returns each document with its current state. The goal is to surface a non-blocking
confirmation banner on PTR and PFS documents when joint filing is likely.

**Step 1 — Extend `IntakeDoc` type:**

```typescript
type IntakeDoc = {
  // ... existing fields ...
  subject_id: string | null;          // existing single-entity binding
  subject_ids: string[] | null;       // new: multi-entity binding (Phase 82)
  joint_filer_confirmed: boolean | null;
  joint_filer_detection_source: string | null;
  // These come from extracted facts (populated by processing pipeline)
  ptr_filing_status: string | null;   // "MFJ" | "SINGLE" etc if extracted
  ptr_spouse_name: string | null;     // spouse name if MFJ detected
  pfs_is_joint: boolean | null;       // true if two signatories detected
  pfs_co_applicant_name: string | null;
};
```

**Step 2 — Extend the `/api/deals/[dealId]/intake/review` endpoint** to return these new
fields from `deal_documents` and join `deal_financial_facts` to populate
`ptr_filing_status`, `ptr_spouse_name`, `pfs_is_joint`, `pfs_co_applicant_name`
from extracted facts for each document.

Find the review endpoint (likely at
`src/app/api/deals/[dealId]/intake/review/route.ts`) and add these joins.

**Step 3 — Add deal guarantors fetch to `IntakeReviewTable`:**

Add a new state variable and fetch at component mount:

```typescript
type Guarantor = { id: string; legal_name: string; entity_type: "personal" | "business" };
const [guarantors, setGuarantors] = useState<Guarantor[]>([]);

useEffect(() => {
  fetch(`/api/deals/${dealId}/entities?type=personal`)
    .then(r => r.json())
    .then(data => { if (data.ok) setGuarantors(data.entities ?? []); })
    .catch(() => {});
}, [dealId]);
```

**Step 4 — Add joint filer detection logic (pure function, place above component):**

```typescript
type JointFilingSignal = {
  shouldSuggest: boolean;
  reason: "mfj_detected" | "joint_pfs_detected" | "same_lastname_guarantors" | null;
  spouseName: string | null;
  coApplicantName: string | null;
};

function detectJointFilingSignal(
  doc: IntakeDoc,
  guarantors: Guarantor[],
): JointFilingSignal {
  // Signal 1: MFJ explicitly detected by extraction pipeline
  if (doc.ptr_filing_status === "MFJ") {
    return {
      shouldSuggest: true,
      reason: "mfj_detected",
      spouseName: doc.ptr_spouse_name,
      coApplicantName: null,
    };
  }

  // Signal 2: Joint PFS detected (two signatories)
  if (doc.pfs_is_joint === true) {
    return {
      shouldSuggest: true,
      reason: "joint_pfs_detected",
      spouseName: null,
      coApplicantName: doc.pfs_co_applicant_name,
    };
  }

  // Signal 3: Two personal guarantors share the same last name AND
  // this is a PTR or PFS document with only one binding
  const isPtrOrPfs =
    doc.canonical_type === "PERSONAL_TAX_RETURN" ||
    doc.canonical_type === "PERSONAL_FINANCIAL_STATEMENT";

  if (isPtrOrPfs && guarantors.length >= 2) {
    const personalGuarantors = guarantors.filter(g => g.entity_type === "personal");
    if (personalGuarantors.length >= 2) {
      // Extract last names
      const lastNames = personalGuarantors.map(g => {
        const parts = g.legal_name.trim().split(/\s+/);
        return parts[parts.length - 1].toLowerCase();
      });
      const uniqueLastNames = new Set(lastNames);
      if (uniqueLastNames.size === 1) {
        // All personal guarantors share a last name — likely married couple
        return {
          shouldSuggest: true,
          reason: "same_lastname_guarantors",
          spouseName: null,
          coApplicantName: null,
        };
      }
    }
  }

  return { shouldSuggest: false, reason: null, spouseName: null, coApplicantName: null };
}
```

**Step 5 — Add joint filer banner component (place inside the table row, after the
existing status/action cells, only for PTR and PFS documents):**

Add state for tracking banner dismissals:
```typescript
const [dismissedJointBanners, setDismissedJointBanners] = useState<Set<string>>(new Set());
const [jointBindingInFlight, setJointBindingInFlight] = useState<Set<string>>(new Set());
```

Add a `JointFilingBanner` component:

```typescript
function JointFilingBanner({
  doc,
  signal,
  guarantors,
  dealId,
  onConfirm,
  onDeny,
  onDismiss,
}: {
  doc: IntakeDoc;
  signal: JointFilingSignal;
  guarantors: Guarantor[];
  dealId: string;
  onConfirm: () => void;
  onDeny: () => void;
  onDismiss: () => void;
}) {
  const personalGuarantors = guarantors.filter(g => g.entity_type === "personal");

  const bannerText = (() => {
    if (signal.reason === "mfj_detected") {
      const spousePart = signal.spouseName ? ` (${signal.spouseName})` : "";
      return `Buddy detected "Married Filing Jointly" on this return${spousePart}. Should it cover both guarantors?`;
    }
    if (signal.reason === "joint_pfs_detected") {
      const coPart = signal.coApplicantName ? ` and ${signal.coApplicantName}` : "";
      return `This PFS appears to have two signatories${coPart}. Should it cover both guarantors?`;
    }
    if (signal.reason === "same_lastname_guarantors" && personalGuarantors.length >= 2) {
      const names = personalGuarantors.map(g => g.legal_name).join(" and ");
      return `${names} share the same last name. Do they file jointly and share personal documents?`;
    }
    return "This document may cover multiple guarantors. Does it apply to both?";
  })();

  return (
    <tr>
      <td colSpan={6} className="px-2 pb-2">
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 flex items-center gap-3">
          <span className="material-symbols-outlined text-blue-400 text-[16px] flex-shrink-0">
            family_restroom
          </span>
          <p className="text-xs text-white/60 flex-1">{bannerText}</p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onDeny}
              className="text-[10px] px-2 py-1 rounded border border-white/10 text-white/40 hover:bg-white/5"
            >
              No
            </button>
            <button
              onClick={onConfirm}
              className="text-[10px] px-2 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 font-medium"
            >
              Yes, covers both
            </button>
            <button
              onClick={onDismiss}
              className="text-[10px] text-white/25 hover:text-white/40"
            >
              ✕
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}
```

**Step 6 — Wire the banner into the table body:**

For each document row, after the `</tr>` closing tag, add:

```typescript
{(() => {
  // Only show banner for PTR/PFS documents that haven't been joint-confirmed/denied
  const isPtrOrPfs =
    doc.canonical_type === "PERSONAL_TAX_RETURN" ||
    doc.canonical_type === "PERSONAL_FINANCIAL_STATEMENT";

  if (!isPtrOrPfs) return null;
  if (doc.joint_filer_confirmed !== null) return null; // already decided
  if (dismissedJointBanners.has(doc.id)) return null;
  if (guarantors.filter(g => g.entity_type === "personal").length < 2) return null;

  const signal = detectJointFilingSignal(doc, guarantors);
  if (!signal.shouldSuggest) return null;

  return (
    <JointFilingBanner
      doc={doc}
      signal={signal}
      guarantors={guarantors}
      dealId={dealId}
      onDismiss={() => setDismissedJointBanners(prev => new Set([...prev, doc.id]))}
      onDeny={async () => {
        setJointBindingInFlight(prev => new Set([...prev, doc.id]));
        try {
          await fetch(`/api/deals/${dealId}/intake/documents/${doc.id}/joint-bind`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subject_ids: [doc.subject_id].filter(Boolean),
              confirmed: false,
              detection_source: "banker_denied",
            }),
          });
          await refresh();
        } finally {
          setJointBindingInFlight(prev => {
            const next = new Set(prev);
            next.delete(doc.id);
            return next;
          });
        }
      }}
      onConfirm={async () => {
        setJointBindingInFlight(prev => new Set([...prev, doc.id]));
        const personalGuarantorIds = guarantors
          .filter(g => g.entity_type === "personal")
          .map(g => g.id)
          .slice(0, 2); // max 2 for joint filing
        try {
          await fetch(`/api/deals/${dealId}/intake/documents/${doc.id}/joint-bind`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subject_ids: personalGuarantorIds,
              confirmed: true,
              detection_source: signal.reason === "mfj_detected"
                ? "auto_mfj"
                : signal.reason === "joint_pfs_detected"
                ? "auto_joint_pfs"
                : "banker_confirmed",
            }),
          });
          await refresh();
        } finally {
          setJointBindingInFlight(prev => {
            const next = new Set(prev);
            next.delete(doc.id);
            return next;
          });
        }
      }}
    />
  );
})()}
```

---

## Part 5 — Layer 4: Checklist Satisfaction for Joint Documents

### File: `src/lib/checklist/engine.ts`

The `reconcileChecklistForDeal` function currently satisfies checklist items based on
`deal_documents.checklist_key` matching `deal_checklist_items.checklist_key`.

**Add joint-binding awareness to the document query:**

Find the `matchedDocs` query and extend the SELECT to include the new joint columns:

```typescript
const { data: matchedDocs } = await sb
  .from("deal_documents")
  .select("id, checklist_key, doc_year, doc_years, document_type, subject_id, subject_ids, joint_filer_confirmed")
  .eq("deal_id", dealId);
```

**Update the "no guarantor binding" warning logic:**

Currently the system flags PTRs with `subject_id = null` as missing guarantor binding.
This warning should be suppressed for documents where `joint_filer_confirmed = true`
because the joint binding in `subject_ids` covers it.

Find where `entity_binding_required` is computed (likely in the processing-status route
or the review route) and add:

```typescript
// A document with joint_filer_confirmed=true satisfies entity binding
// even if subject_id is null — subject_ids covers it
const unboundPersonalDocs = personalDocs.filter(doc =>
  !doc.subject_id &&
  !(doc.joint_filer_confirmed === true && doc.subject_ids?.length > 0)
);
```

**Update the "personal tax return has no guarantor binding" checklist warning:**

Find in the checklist reconcile logic where the "awaiting guarantor binding" message
is generated for personal tax returns. Add:

```typescript
// Joint-confirmed documents satisfy binding for ALL entities in subject_ids
const isJointBound = doc.joint_filer_confirmed === true &&
  Array.isArray(doc.subject_ids) &&
  doc.subject_ids.length > 0;

if (!doc.subject_id && !isJointBound) {
  // Only flag as unbound if truly unbound
  unboundWarnings.push(doc.id);
}
```

---

## Part 6 — Suppress "awaiting guarantor binding" Warning for Joint Docs

The checklist item description currently reads:
> "Personal tax return has no guarantor binding (subject_id)"

This fires on every PTR where `subject_id IS NULL`. After Phase 82, a joint PTR
will have `subject_id = null` (primary entity) but `subject_ids = [kevin_id, martina_id]`
and `joint_filer_confirmed = true`.

**File:** `src/lib/checklist/engine.ts` (or wherever this warning text is generated)

Find the logic that produces "Personal tax return has no guarantor binding" and
add the joint check before firing it:

```typescript
const hasValidBinding =
  Boolean(doc.subject_id) ||
  (doc.joint_filer_confirmed === true && (doc.subject_ids?.length ?? 0) > 0);

if (!hasValidBinding) {
  // Fire the warning
}
// else: jointly bound — no warning needed
```

---

## Part 7 — `/api/deals/[dealId]/entities` Endpoint

The `IntakeReviewTable` fetches `?type=personal` to get guarantors. This endpoint
may or may not exist. Check `src/app/api/deals/[dealId]/entities/route.ts`.

If it exists: confirm it accepts `?type=personal` and returns `{ ok: true, entities: [...] }`.

If it does NOT exist: create it. Minimal implementation:

```typescript
// GET /api/deals/[dealId]/entities?type=personal|business|all
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: 403 });

  const type = req.nextUrl.searchParams.get("type"); // "personal" | "business" | null

  const sb = supabaseAdmin();
  let query = (sb as any)
    .from("deal_entities")
    .select("id, legal_name, entity_type, subject_role")
    .eq("deal_id", dealId);

  if (type === "personal") query = query.eq("entity_type", "personal");
  if (type === "business") query = query.eq("entity_type", "business");

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, entities: data ?? [] });
}
```

Note: The table name may differ (`deal_participants`, `deal_subjects`, `borrower_entities`, etc.)
— find the right table by checking the schema or existing entity-related queries in the codebase.

---

## Part 8 — TypeScript Checks

After all edits, run:
```bash
npx tsc --noEmit 2>&1 | grep -v "pdf/route.ts"
```

Fix any new type errors before committing. The `subject_ids UUID[]` is nullable so
always guard with `?? []` or `Array.isArray()` checks.

---

## Part 9 — Test Criteria

After implementation, the following must work on the Ellmann Part 2 deal:

| Scenario | Expected behavior |
|----------|------------------|
| Upload joint 1040 MFJ | Extraction writes `PTR_FILING_STATUS = "MFJ"` to `deal_financial_facts` |
| During intake review, joint 1040 present | Blue banner appears: "Buddy detected Married Filing Jointly. Cover both guarantors?" |
| Banker clicks "Yes, covers both" | `subject_ids = [kevin_id, martina_id]`, `joint_filer_confirmed = true` |
| After joint confirm | "awaiting guarantor binding" warning disappears for this document |
| Joint PFS uploaded | `PFS_IS_JOINT = true` extracted, banner appears with co-applicant name |
| Two guarantors with same last name, no MFJ detected | Banner appears with same-lastname heuristic text |
| Banker clicks "No" | `joint_filer_confirmed = false`, banner disappears, normal single-entity flow |
| Same-session retry | Banner does not re-appear for documents already decided |

---

## Part 10 — Commit Message

```
feat(phase-82): Joint Filer Intelligence — married couple document deduplication

Layer 1: personalIncomeDeterministic.ts + pfsDeterministic.ts now extract
  PTR_FILING_STATUS, PTR_SPOUSE_NAME, PFS_IS_JOINT, PFS_CO_APPLICANT_NAME

Layer 2: Migration 20260416000000 adds subject_ids UUID[] + joint_filer_confirmed
  to deal_documents. Backfills subject_ids from existing subject_id.

Layer 3: IntakeReviewTable shows non-blocking joint filer confirmation banner
  when MFJ detected, joint PFS detected, or same-last-name guarantors present.
  New /joint-bind route handles banker confirm/deny.

Layer 4: Checklist engine suppresses "no guarantor binding" warning for
  joint_filer_confirmed documents.

Also: CockpitBorrowerIdentity — "contact support" → "not yet linked" (white)

~40% of community bank guarantor pairs are married co-owners who file jointly.
One set of documents is legally correct and always has been.
```

---

## Implementation Order (strictly follow this sequence)

1. `DealCockpitClient.tsx` — text fix (Part 0)
2. `supabase/migrations/20260416000000_joint_filer_entity_binding.sql` — apply migration (Part 3)
3. `src/lib/financialFacts/keys.ts` — add 4 fact keys (Part 2a)
4. `src/lib/financialSpreads/extractors/deterministic/personalIncomeDeterministic.ts` — MFJ detection (Part 2b)
5. `src/lib/financialSpreads/extractors/deterministic/pfsDeterministic.ts` — joint PFS detection (Part 2c)
6. `src/app/api/deals/[dealId]/intake/documents/[documentId]/joint-bind/route.ts` — new endpoint (Part 4a)
7. `src/app/api/deals/[dealId]/entities/route.ts` — create or verify (Part 7)
8. Update `/intake/review` route to return new fields (Part 4b, Step 2)
9. `src/components/deals/intake/IntakeReviewTable.tsx` — banner (Part 4b, Steps 3-6)
10. `src/lib/checklist/engine.ts` — joint satisfaction (Parts 5 and 6)
11. `npx tsc --noEmit` — verify clean
12. Commit and push
