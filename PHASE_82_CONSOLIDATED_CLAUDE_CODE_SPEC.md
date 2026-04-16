# CLAUDE CODE — Session Spec
# Migration Drift Fix + Phase 82 Proof of Truth Layer
# One paste, two tasks, strict order

---

## TASK 1 OF 2 — Migration Drift Documentation (do this first, 5 minutes)

### Background (read before touching anything)

Production Supabase has **two parallel migration histories** that diverged around 2026-03-25:

- **Before 2026-03-25:** Local `.sql` files in `supabase/migrations/` and remote
  `schema_migrations` are in sync. All is clean.
- **From 2026-03-25 onwards:** Migrations were applied via MCP `apply_migration` which
  auto-generates full `YYYYMMDDHHMMSS` version IDs. Local files use `YYYYMMDD_name.sql`
  date-only prefixes. The version IDs do NOT match. The DDL is all live and correct.
  Only the bookkeeping is misaligned.

**The dangerous operation is `supabase db push --include-all`.** It would attempt to
re-execute ~100+ local files whose DDL already exists in production, producing "already
exists" errors. **Do not run it.** This task only creates documentation.

### What to do

**Create this file exactly as written:**

**File: `supabase/migrations/README.md`**

```markdown
# Supabase Migrations — Read Before Running db push

## TL;DR

**Do NOT run `supabase db push` or `supabase db push --include-all` without reading this.**
**All new migrations must use MCP `apply_migration` only.**

---

## Migration History State (as of April 2026)

### Before 2026-03-25 — Clean
All local `.sql` files and remote `schema_migrations` are in sync.
Local version IDs match remote recorded versions exactly.

### From 2026-03-25 onwards — Diverged (intentionally)
Two workflows ran in parallel:

**Workflow A (local files):**
Files like `20260326_auto_intelligence_pipeline.sql` have version prefix `20260326`.

**Workflow B (MCP apply_migration):**
Same DDL applied via MCP generated versions like `20260326153556`, `20260326160928`.
These are recorded in `schema_migrations`. The local file versions are NOT recorded.

**Result:** ~150 local files from 2026-03-25 onwards have version IDs that do NOT
appear in `schema_migrations`. The DDL they represent IS live in production.
Running `db push` would attempt to re-apply them and fail.

---

## Safe Operations

| Operation | Safe? | Notes |
|-----------|-------|-------|
| `supabase migration list` | ✅ | Shows the drift. Expected. |
| `apply_migration` via MCP | ✅ | Correct workflow going forward. |
| `supabase db push --dry-run` | ⚠️ | Review output carefully before acting. |
| `supabase db push` | ❌ | Will attempt to re-apply already-applied DDL. |
| `supabase db push --include-all` | ❌ | Same — will fail on conflicts. |

---

## Workflow Going Forward

**All new schema changes must use MCP `apply_migration` only.**

```
# Correct — use this
apply_migration(name: "my_feature", query: "ALTER TABLE ...")

# Wrong — do not use this
supabase db push
```

New `.sql` files in `supabase/migrations/` are source code documentation only.
They are NOT applied via `db push`. The MCP tool is the only application path.

---

## If You Need to Repair the History Table

Do NOT attempt this without a full diff review. The repair command is:
```
supabase migration repair --status applied <version>
```
Run it once per unrecorded local file version to mark it as applied without re-running DDL.
Only do this after confirming the DDL is already live in production.

---

## Seed Files

`seed_policy_defaults.sql`, `seed_policy_mitigants.sql`, `seed_policy_rules.sql` have no
timestamp prefix and are not tracked by `schema_migrations`. This is intentional.
They are reference seeds, not migration files.
```

**After creating the README, do nothing else for Task 1. Do not touch any migration files,
do not run any supabase commands, do not modify schema_migrations.**

---

## TASK 2 OF 2 — Phase 82: Proof of Truth Layer

### What has already shipped (do NOT rebuild)

Read `PHASE_82_PROOF_OF_TRUTH.md` in the repo root for the full architectural context.
The short version of what already exists:

- `claimLedger.ts` — persists claims to `buddy_research_evidence` with `claim_layer: "fact" | "inference" | "narrative"` per claim, `section`, `source_uris`, `source_types`
- `memoEvidenceResolver.ts` — builds `research_trace_json` as `{ sections: [{ section_key, claim_ids, evidence_count }] }` and persists it to `canonical_memo_narratives`
- `completionGate.ts` — 8 gates (Gates 0-7), NAICS guard, contradiction coverage with 8 required checks, section-level source requirements
- `CommitteeCertification` type in `types.ts` — committee eligibility banner computed in `buildCanonicalCreditMemo.ts`
- `EvidenceTag` component — in `CanonicalMemoTemplate.tsx`, shows evidence per section
- `goldenSet.ts` with 6 cases — in `src/lib/research/evals/goldenSet.ts`
- `lintCanonicalMemo` — in `src/lib/creditMemo/memoLint.ts`
- `loadTrustGradeForDeal` — in `src/lib/research/trustEnforcement.ts`

### What NOT to build (critical — read carefully)

**Do NOT build sentence-level claim matching.** ChatGPT's original Phase 82 spec proposed
matching memo prose sentences to specific evidence row IDs. That requires NLP semantic
matching (a second AI call per sentence) which doesn't exist in this codebase and isn't
needed. Section-level evidence counts from `research_trace_json` give 90% of the value
at 10% of the complexity.

---

### Sprint 1 — `src/lib/research/evidenceCoverage.ts` (new file)

Create exactly this file:

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type EvidenceCoverageResult = {
  totalSections: number;
  supportedSections: number;
  unsupportedSections: number;
  supportRatio: number; // 0.0–1.0
  sectionBreakdown: Array<{
    sectionKey: string;
    evidenceCount: number;
    supported: boolean;
  }>;
};

/**
 * Compute evidence coverage from research_trace_json on the latest generated memo.
 * Uses section-level evidence counts — no NLP sentence matching required.
 * Returns null when no memo has been generated yet (new deals).
 */
export async function computeEvidenceCoverage(
  dealId: string,
  bankId: string,
): Promise<EvidenceCoverageResult | null> {
  const sb = supabaseAdmin();

  const { data } = await (sb as any)
    .from("canonical_memo_narratives")
    .select("research_trace_json")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.research_trace_json) return null;

  const trace = data.research_trace_json as {
    sections: Array<{ section_key: string; claim_ids: string[]; evidence_count: number }>;
  };

  if (!trace.sections?.length) return null;

  const MIN_EVIDENCE_FOR_SUPPORTED = 1;
  const breakdown = trace.sections.map((s) => ({
    sectionKey: s.section_key,
    evidenceCount: s.evidence_count,
    supported: s.evidence_count >= MIN_EVIDENCE_FOR_SUPPORTED,
  }));

  const totalSections = breakdown.length;
  const supportedSections = breakdown.filter((s) => s.supported).length;

  return {
    totalSections,
    supportedSections,
    unsupportedSections: totalSections - supportedSections,
    supportRatio: totalSections > 0 ? supportedSections / totalSections : 0,
    sectionBreakdown: breakdown,
  };
}
```

---

### Sprint 2 — Extend `CommitteeCertification` type and computation

**File: `src/lib/creditMemo/canonical/types.ts`**

Find the `CommitteeCertification` type (added in Phase 81). Add two fields:

```typescript
export type CommitteeCertification = {
  // ... existing fields ...
  evidenceSupportRatio: number | null;  // 0.0–1.0, null if no research trace yet
  unsupportedSections: string[];        // section_keys with evidence_count === 0
};
```

**File: `src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts`**

1. Import `computeEvidenceCoverage`:
   ```typescript
   import { computeEvidenceCoverage } from "@/lib/research/evidenceCoverage";
   ```

2. After the block where `trustGrade` is loaded, add:
   ```typescript
   const evidenceCoverage = await computeEvidenceCoverage(args.dealId, bankId);
   const evidenceSupportRatio = evidenceCoverage?.supportRatio ?? null;
   const unsupportedSectionKeys = evidenceCoverage
     ? evidenceCoverage.sectionBreakdown.filter(s => !s.supported).map(s => s.sectionKey)
     : [];
   ```

3. Add to `reasonsBlocked` (before building the `CommitteeCertification` object):
   ```typescript
   if (evidenceSupportRatio !== null && evidenceSupportRatio < 0.70) {
     reasonsBlocked.push(
       `Evidence support is ${Math.round(evidenceSupportRatio * 100)}% — 70% minimum required`,
     );
   }
   ```

4. Populate the new fields in the `CommitteeCertification` object:
   ```typescript
   const committee_certification: CommitteeCertification = {
     // ... existing fields unchanged ...
     evidenceSupportRatio,
     unsupportedSections: unsupportedSectionKeys,
   };
   ```

**File: `src/components/creditMemo/CanonicalMemoTemplate.tsx`**

Find the certification banner (the green/amber/red block added in Phase 81). Inside the
amber "not committee-ready" branch, add evidence coverage display:

```tsx
{cert.evidenceSupportRatio !== null && (
  <div className="text-xs text-amber-700 mt-1">
    Evidence coverage: {Math.round(cert.evidenceSupportRatio * 100)}%
    {cert.unsupportedSections.length > 0 && (
      <span className="ml-1">
        ({cert.unsupportedSections.length} section{cert.unsupportedSections.length !== 1 ? "s" : ""} with no evidence:
        {" "}{cert.unsupportedSections.slice(0, 3).join(", ")}
        {cert.unsupportedSections.length > 3 && ` +${cert.unsupportedSections.length - 3} more`})
      </span>
    )}
  </div>
)}
```

Also add to the green "committee certified" branch:
```tsx
{cert.evidenceSupportRatio !== null && (
  <span className="text-xs text-emerald-600 ml-2">
    Evidence: {Math.round(cert.evidenceSupportRatio * 100)}%
  </span>
)}
```

---

### Sprint 3 — Gate 9 in `completionGate.ts`

**File: `src/lib/research/completionGate.ts`**

**Step 3a — Update `opts` type:**

```typescript
// Find the existing opts parameter type and add evidenceSupportRatio:
opts?: {
  naicsCode?: string | null;
  evidenceSupportRatio?: number | null;  // ADD THIS
}
```

**Step 3b — Add Gate 9 after Gate 8:**

Add this block immediately after the Gate 8 (section_source_coverage) check push:

```typescript
// ── Gate 9 (Phase 82): Evidence Coverage Density ─────────────────────────
// Only fires when a research trace exists (memo has been generated).
// New deals with no memo are exempt — evidenceSupportRatio will be null.
const evidenceRatio = opts?.evidenceSupportRatio ?? null;
if (evidenceRatio !== null) {
  checks.push({
    gate_id: "evidence_coverage",
    label: "Evidence Coverage Density",
    status: evidenceRatio >= 0.85 ? "pass" : evidenceRatio >= 0.70 ? "warn" : "fail",
    reason: evidenceRatio >= 0.85
      ? `Strong evidence coverage — ${Math.round(evidenceRatio * 100)}% of sections backed by evidence`
      : evidenceRatio >= 0.70
        ? `Moderate evidence coverage (${Math.round(evidenceRatio * 100)}%) — 85% required for committee_grade`
        : `Weak evidence coverage — only ${Math.round(evidenceRatio * 100)}% of sections have evidence rows`,
    severity: evidenceRatio < 0.70 ? "warn" : "info",
  });
}
```

**Step 3c — Add evidence coverage to committee_grade condition:**

Find the `trustGrade = "committee_grade"` assignment. In the `else if` block containing
all the committee_grade conditions, add this condition to the chain:

```typescript
&& (evidenceRatio === null || evidenceRatio >= 0.85)
```

Place it after `!naicsIsPlaceholder &&` on its own line for readability.

**Step 3d — Update `runMission.ts` to pass coverage ratio:**

**File: `src/lib/research/runMission.ts`**

Add import:
```typescript
import { computeEvidenceCoverage } from "./evidenceCoverage";
```

In the block where `evaluateCompletionGate` is called (inside the try block after
`persistClaimLedger`), replace the existing call with:

```typescript
// Compute evidence coverage from any previously generated memo
// (will be null for first research run on a new deal)
const evidenceCoverage = await computeEvidenceCoverage(dealId, opts?.bankId ?? "");

const gateResult = evaluateCompletionGate(bieResult, missionId, {
  naicsCode: subject.naics_code,
  evidenceSupportRatio: evidenceCoverage?.supportRatio ?? null,
});
```

---

### Sprint 4 — Inference Layer Surfacing

**File: `src/app/api/deals/[dealId]/research/evidence/route.ts`**

Find where evidence rows are grouped by section. After grouping, compute and return
per-section inference ratios alongside the existing data:

```typescript
// After grouping rows by section, compute stats:
const sectionStats = Object.entries(groupedBySection).map(([section, rows]) => {
  const total = (rows as any[]).length;
  const inferences = (rows as any[]).filter((r: any) => r.evidence_type === "inference").length;
  return {
    section,
    total,
    inferences,
    inferenceRatio: total > 0 ? inferences / total : 0,
    isInferenceDominated: total > 0 && (inferences / total) > 0.6,
  };
});

// Include in response:
return NextResponse.json({
  ok: true,
  // ... existing fields ...
  sectionStats,
});
```

**File: `src/components/creditMemo/CanonicalMemoTemplate.tsx`**

Find the `EvidenceTag` component (added in Phase 81). Extend it to show inference dominance.
The `section` object from `research_trace_json` may not have `inferenceRatio` yet — add it
as an optional field and handle absence gracefully:

```typescript
// Add to the ResearchTraceSection type (or wherever it's defined):
inferenceRatio?: number;
isInferenceDominated?: boolean;
```

In the `EvidenceTag` render:

```tsx
function EvidenceTag({ sectionKey, trace }: { sectionKey: string; trace: ResearchTrace }) {
  if (!trace) return null;
  const section = trace.sections?.find(s => s.section_key === sectionKey);
  if (!section) return (
    <span className="text-[10px] text-gray-300 ml-2">No evidence</span>
  );

  const isInferenceDominated = section.isInferenceDominated ?? false;

  return (
    <details className="inline-block ml-2 relative">
      <summary className={`text-[10px] cursor-pointer hover:opacity-80 ${isInferenceDominated ? "text-amber-500" : "text-sky-500"}`}>
        {section.evidence_count} evidence{isInferenceDominated && " · inference"}
      </summary>
      <div className="absolute z-10 mt-1 w-64 rounded border border-gray-200 bg-white shadow-lg p-2.5 text-xs">
        <div className="font-medium text-gray-700 mb-1">{sectionKey}</div>
        <div className="text-gray-500">{section.evidence_count} evidence rows</div>
        {isInferenceDominated && (
          <div className="text-amber-700 text-[10px] mt-1.5 border-t border-amber-100 pt-1">
            Primarily analyst inference — not directly verifiable public record.
          </div>
        )}
        {section.claim_ids.length > 0 && (
          <div className="text-gray-400 text-[9px] mt-1 font-mono truncate">
            {section.claim_ids.slice(0, 2).join(", ")}
            {section.claim_ids.length > 2 && ` +${section.claim_ids.length - 2}`}
          </div>
        )}
      </div>
    </details>
  );
}
```

Apply `EvidenceTag` to inference-dominated sections that don't have it yet:
- `Credit Thesis` subsection header
- `Transaction Analysis` subsection header
- `Structure Implications` subsection header
- `Underwriting Questions` subsection header

Use `sectionKey` values: `"credit_thesis"`, `"transaction_analysis"`,
`"structure_implications"`, `"underwriting_questions"`.

---

### Sprint 5 — Contradiction Quality Scoring

**File: `src/lib/research/completionGate.ts`**

**Step 5a — Add imports at the top of the file** (if not already present):

```typescript
import type { BIEResult } from "./buddyIntelligenceEngine";
```

`classifySourceUrl` is already imported from `sourcePolicy`.

**Step 5b — Add thread-to-check mapping and strength computation:**

Add after the `CHECK_PATTERNS` definition (before `evaluateContradictionCoverage`):

```typescript
// Mapping: which BIE thread's sources are authoritative for each contradiction check
const THREAD_FOR_CONTRADICTION_CHECK: Record<ContradictionCheckKey, keyof typeof emptyThreadSources> = {
  identity_mismatch: "borrower",
  dba_mismatch: "borrower",
  geography_mismatch: "market",
  scale_plausibility: "borrower",
  management_history_conflict: "management",
  regulatory_vs_margin: "industry",
  competitive_position_conflict: "competitive",
  repayment_story_conflict: "transaction",
};

const PRIMARY_SOURCE_TYPES_FOR_STRENGTH = new Set([
  "court_record", "regulatory_filing", "government_data",
  "company_primary", "news_primary", "market_research", "trade_publication",
]);

function computeContradictionStrength(
  checkKey: ContradictionCheckKey,
  threadSources: BIEResult["thread_sources"],
): "strong" | "weak" | "none" {
  const thread = THREAD_FOR_CONTRADICTION_CHECK[checkKey];
  const urls: string[] = (threadSources as any)[thread] ?? [];
  if (urls.length === 0) return "none";

  const primaryCount = urls.filter((url) =>
    PRIMARY_SOURCE_TYPES_FOR_STRENGTH.has(classifySourceUrl(url)),
  ).length;

  if (primaryCount >= 2) return "strong";
  if (primaryCount >= 1) return "weak";
  return "none";
}

// Helper for the mapping above — matches BIEResult.thread_sources shape
const emptyThreadSources = {
  borrower: [] as string[],
  management: [] as string[],
  competitive: [] as string[],
  market: [] as string[],
  industry: [] as string[],
  transaction: [] as string[],
  entity_lock: [] as string[],
};
```

**Step 5c — Update `evaluateContradictionCoverage` signature** to accept `bieResult`:

The function currently is:
```typescript
function evaluateContradictionCoverage(bieResult: BIEResult): ...
```

It already accepts `bieResult`. Add strength computation after the covered/missing loop:

```typescript
// After building covered[] and missing[], add:
const strengthByCheck: Record<string, "strong" | "weak" | "none"> = {};
let strongCount = 0;
let weakOrNoneCount = 0;

for (const checkKey of covered) {
  const strength = computeContradictionStrength(checkKey, bieResult.thread_sources);
  strengthByCheck[checkKey] = strength;
  if (strength === "strong") strongCount++;
  else weakOrNoneCount++;
}

const strengthRatio = covered.length > 0 ? strongCount / covered.length : 0;
```

**Step 5d — Update the gate check reason to include strength info:**

```typescript
const check: GateCheckResult = {
  gate_id: "contradiction_coverage",
  label: "Adversarial Contradiction Coverage",
  status: missing.length === 0 ? "pass" : missing.length <= 3 ? "warn" : "fail",
  reason: missing.length === 0
    ? `All ${REQUIRED_CONTRADICTION_CHECKS.length} checks addressed (${strongCount} strong, ${weakOrNoneCount} weak/none)`
    : `${covered.length}/${REQUIRED_CONTRADICTION_CHECKS.length} checks addressed (${strongCount} strong, ${weakOrNoneCount} weak/none) — missing: ${missing.join(", ")}`,
  severity: missing.length > 3 ? "warn" : "info",
};
```

**Important:** Contradiction strength is informational metadata, NOT a new hard blocker.
Do not add a `fail` severity for weak strength. The quality score (`warnCount` deductions)
naturally reflects weak coverage without blocking legitimate deals.

---

### Sprint 6 — Golden Set Expansion

**File: `src/lib/research/evals/goldenSet.ts`**

Find the existing `GOLDEN_SET` array with 6 cases. Add these 14 placeholder cases at the end:

```typescript
// ─────────────────────────────────────────────────────────────
// PLACEHOLDER CASES — Matt must populate dealId from production
// Run: npm run audit:memo POPULATE_FROM_PROD_<id> <bankId>
// to verify each case before replacing the placeholder.
// ─────────────────────────────────────────────────────────────

{
  id: "cre-stabilized",
  name: "CRE Stabilized — Investment Property",
  description: "Stabilized multifamily or retail, full rent roll, strong sponsor",
  subject: {
    company_name: "POPULATE_FROM_PROD",
    naics_code: "531110",
    naics_description: "Lessors of Residential Buildings and Dwellings",
    business_description: "Stabilized multifamily property, full occupancy",
    city: "POPULATE_FROM_PROD",
    state: "POPULATE_FROM_PROD",
  },
  expected: {
    subjectLockPasses: true,
    maxTrustGrade: "committee_grade" as const,
    memoShouldHavePending: false,
    memoShouldBeCommitteeEligible: true,
    notes: "Full data deal — should produce committee_grade",
  },
},
{
  id: "cre-transitional",
  name: "CRE Transitional — Value-Add",
  description: "Value-add with lease-up risk, construction component",
  subject: {
    company_name: "POPULATE_FROM_PROD",
    naics_code: "531120",
    naics_description: "Lessors of Nonresidential Buildings",
    business_description: "Office building undergoing renovation and lease-up",
    city: "POPULATE_FROM_PROD",
    state: "POPULATE_FROM_PROD",
  },
  expected: {
    subjectLockPasses: true,
    maxTrustGrade: "preliminary" as const,
    memoShouldHavePending: true,
    memoShouldBeCommitteeEligible: false,
    notes: "Transitional — incomplete occupancy data, preliminary grade expected",
  },
},
{
  id: "sba-7a-service",
  name: "SBA 7(a) Service Business",
  description: "Operating service company, SBA 7(a), established web presence",
  subject: {
    company_name: "POPULATE_FROM_PROD",
    naics_code: "561210",
    naics_description: "Facilities Support Services",
    business_description: "Commercial cleaning and facility maintenance",
    city: "POPULATE_FROM_PROD",
    state: "POPULATE_FROM_PROD",
    website: "POPULATE_FROM_PROD",
  },
  expected: {
    subjectLockPasses: true,
    maxTrustGrade: "committee_grade" as const,
    memoShouldHavePending: false,
    memoShouldBeCommitteeEligible: true,
    notes: "Clean SBA deal with good web presence",
  },
},
{
  id: "sba-504-owner-occupied",
  name: "SBA 504 Owner-Occupied CRE",
  description: "504 deal, 10% equity, CDC, equipment component",
  subject: {
    company_name: "POPULATE_FROM_PROD",
    naics_code: "POPULATE_FROM_PROD",
    naics_description: "POPULATE_FROM_PROD",
    business_description: "POPULATE_FROM_PROD",
    city: "POPULATE_FROM_PROD",
    state: "POPULATE_FROM_PROD",
  },
  expected: {
    subjectLockPasses: true,
    maxTrustGrade: "committee_grade" as const,
    memoShouldHavePending: false,
    memoShouldBeCommitteeEligible: true,
    notes: "SBA 504 with full package",
  },
},
{
  id: "dba-mismatch",
  name: "DBA Mismatch — Legal vs. Operating Name",
  description: "Legal entity and DBA completely different — research drift risk",
  subject: {
    company_name: "POPULATE_FROM_PROD",
    naics_code: "POPULATE_FROM_PROD",
    naics_description: "POPULATE_FROM_PROD",
    business_description: "POPULATE_FROM_PROD",
    dba: "POPULATE_FROM_PROD",
    city: "POPULATE_FROM_PROD",
    state: "POPULATE_FROM_PROD",
  },
  expected: {
    subjectLockPasses: true,
    maxTrustGrade: "preliminary" as const,
    memoShouldHavePending: false,
    memoShouldBeCommitteeEligible: false,
    notes: "DBA mismatch should trigger contradiction check B (dba_mismatch)",
  },
},
{
  id: "operating-strong-web",
  name: "Operating Company — Strong Web Presence",
  description: "Well-known regional brand, reviews, press, clear digital footprint",
  subject: {
    company_name: "POPULATE_FROM_PROD",
    naics_code: "POPULATE_FROM_PROD",
    naics_description: "POPULATE_FROM_PROD",
    business_description: "POPULATE_FROM_PROD",
    city: "POPULATE_FROM_PROD",
    state: "POPULATE_FROM_PROD",
    website: "POPULATE_FROM_PROD",
  },
  expected: {
    subjectLockPasses: true,
    maxTrustGrade: "committee_grade" as const,
    memoShouldHavePending: false,
    memoShouldBeCommitteeEligible: true,
    notes: "Should produce committee_grade with strong entity lock",
  },
},
{
  id: "hospitality-marine",
  name: "Marine / Hospitality — Niche Industry",
  description: "Charter, marina, or watercraft hospitality. Adjacent to yacht-charter failure.",
  subject: {
    company_name: "POPULATE_FROM_PROD",
    naics_code: "713990",
    naics_description: "All Other Amusement and Recreation Industries",
    business_description: "POPULATE_FROM_PROD",
    city: "POPULATE_FROM_PROD",
    state: "POPULATE_FROM_PROD",
  },
  expected: {
    subjectLockPasses: false,
    maxTrustGrade: "preliminary" as const,
    memoShouldHavePending: true,
    memoShouldBeCommitteeEligible: false,
    notes: "Niche with weak public data — preliminary max, not committee",
  },
},
{
  id: "franchise-deal",
  name: "Franchise — Established Brand",
  description: "Named franchise, royalty structure, national franchisor, FDD available",
  subject: {
    company_name: "POPULATE_FROM_PROD",
    naics_code: "POPULATE_FROM_PROD",
    naics_description: "POPULATE_FROM_PROD",
    business_description: "POPULATE_FROM_PROD",
    city: "POPULATE_FROM_PROD",
    state: "POPULATE_FROM_PROD",
  },
  expected: {
    subjectLockPasses: true,
    maxTrustGrade: "committee_grade" as const,
    memoShouldHavePending: false,
    memoShouldBeCommitteeEligible: true,
    notes: "Franchise with strong brand — entity lock should be easy",
  },
},
{
  id: "healthcare-dental",
  name: "Healthcare Practice Acquisition",
  description: "Dental or medical practice, HIPAA, licensing, patient base continuity",
  subject: {
    company_name: "POPULATE_FROM_PROD",
    naics_code: "621210",
    naics_description: "Offices of Dentists",
    business_description: "POPULATE_FROM_PROD",
    city: "POPULATE_FROM_PROD",
    state: "POPULATE_FROM_PROD",
  },
  expected: {
    subjectLockPasses: true,
    maxTrustGrade: "committee_grade" as const,
    memoShouldHavePending: false,
    memoShouldBeCommitteeEligible: true,
    notes: "Healthcare practice acquisition",
  },
},
{
  id: "cannabis-adjacent",
  name: "Cannabis-Adjacent — Heavy Regulatory Scrutiny",
  description: "CBD / hemp wellness products, non-THC, compliance-heavy",
  subject: {
    company_name: "POPULATE_FROM_PROD",
    naics_code: "453998",
    naics_description: "All Other Miscellaneous Store Retailers",
    business_description: "CBD wellness products, retail and e-commerce",
    city: "POPULATE_FROM_PROD",
    state: "POPULATE_FROM_PROD",
  },
  expected: {
    subjectLockPasses: true,
    maxTrustGrade: "preliminary" as const,
    memoShouldHavePending: false,
    memoShouldBeCommitteeEligible: false,
    notes: "Regulatory scrutiny — contradiction coverage for regulatory_vs_margin expected",
  },
},
{
  id: "fraud-unresolved-entity",
  name: "Unresolvable Entity — Fraud-Like Pattern",
  description: "No public records, UPS Store address, name returns nothing",
  subject: {
    company_name: "Ghost Corp LLC",
    naics_code: "999999",
    naics_description: null,
    city: null,
    state: null,
  },
  expected: {
    subjectLockPasses: false,
    maxTrustGrade: "research_failed" as const,
    memoShouldHavePending: true,
    memoShouldBeCommitteeEligible: false,
    notes: "Worst case — should fail hard at subject lock and produce research_failed",
  },
},
{
  id: "low-doc-sparse",
  name: "Low-Doc / Sparse Package",
  description: "Minimal documents, early stage intake, no spreads yet",
  subject: {
    company_name: "POPULATE_FROM_PROD",
    naics_code: "POPULATE_FROM_PROD",
    naics_description: "POPULATE_FROM_PROD",
    business_description: "POPULATE_FROM_PROD",
    city: "POPULATE_FROM_PROD",
    state: "POPULATE_FROM_PROD",
  },
  expected: {
    subjectLockPasses: true,
    maxTrustGrade: "preliminary" as const,
    memoShouldHavePending: true,
    memoShouldBeCommitteeEligible: false,
    notes: "Sparse docs — preliminary trust, pending metrics expected",
  },
},
{
  id: "multi-entity-guarantors",
  name: "Multi-Entity Deal — Multiple Guarantors",
  description: "Multiple personal guarantors, multiple business entities, cross-collateral",
  subject: {
    company_name: "POPULATE_FROM_PROD",
    naics_code: "POPULATE_FROM_PROD",
    naics_description: "POPULATE_FROM_PROD",
    business_description: "POPULATE_FROM_PROD",
    city: "POPULATE_FROM_PROD",
    state: "POPULATE_FROM_PROD",
  },
  expected: {
    subjectLockPasses: true,
    maxTrustGrade: "committee_grade" as const,
    memoShouldHavePending: false,
    memoShouldBeCommitteeEligible: true,
    notes: "Multi-guarantor deal — Phase 82 joint filer logic should satisfy checklist",
  },
},
{
  id: "equipment-specialty",
  name: "Equipment / Specialty Use Case",
  description: "Niche equipment financing, limited comparables, hard to appraise",
  subject: {
    company_name: "POPULATE_FROM_PROD",
    naics_code: "POPULATE_FROM_PROD",
    naics_description: "POPULATE_FROM_PROD",
    business_description: "POPULATE_FROM_PROD",
    city: "POPULATE_FROM_PROD",
    state: "POPULATE_FROM_PROD",
  },
  expected: {
    subjectLockPasses: true,
    maxTrustGrade: "preliminary" as const,
    memoShouldHavePending: true,
    memoShouldBeCommitteeEligible: false,
    notes: "Specialty equipment — collateral adequacy will be uncertain",
  },
},
```

**Also extend `runGoldenSetEval.ts`** to include `evidenceSupportRatio` in results:

Find the `EvalResult` type and add:
```typescript
evidenceSupportRatio: number | null;
```

In the eval loop after building the memo, add:
```typescript
import { computeEvidenceCoverage } from "@/lib/research/evidenceCoverage";

// Inside the loop, after memoResult check:
const coverage = await computeEvidenceCoverage(deal.subject.company_name ?? deal.id, bankId).catch(() => null);
result.evidenceSupportRatio = coverage?.supportRatio ?? null;

// Regression check:
if (deal.expected.memoShouldBeCommitteeEligible && (coverage?.supportRatio ?? 1) < 0.50) {
  failures.push(
    `Evidence support dropped to ${Math.round((coverage?.supportRatio ?? 0) * 100)}% on a committee-eligible deal`
  );
}
```

---

### Sprint 7 — Audit CLI

**File: `src/lib/research/evals/auditMemo.ts`** (new file)

```typescript
/**
 * Phase 82: Memo Truth Audit CLI
 *
 * Usage:
 *   npx tsx src/lib/research/evals/auditMemo.ts <dealId> <bankId>
 *   npm run audit:memo <dealId> <bankId>
 *
 * Outputs a structured diagnostic:
 *   - Trust grade
 *   - Evidence coverage by section
 *   - Inference-dominated sections
 *   - Memo lint results
 *   - Committee certification state
 *   - Golden set match (if applicable)
 */

import { computeEvidenceCoverage } from "@/lib/research/evidenceCoverage";
import { loadTrustGradeForDeal } from "@/lib/research/trustEnforcement";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import { lintCanonicalMemo } from "@/lib/creditMemo/memoLint";
import { GOLDEN_SET } from "./goldenSet";

async function auditMemo(dealId: string, bankId: string) {
  const divider = "─".repeat(50);
  console.log(`\n${divider}`);
  console.log(`BUDDY MEMO TRUTH AUDIT`);
  console.log(`Deal:  ${dealId}`);
  console.log(`Bank:  ${bankId}`);
  console.log(`Time:  ${new Date().toISOString()}`);
  console.log(divider);

  // 1. Trust grade
  const trustGrade = await loadTrustGradeForDeal(dealId).catch(() => null);
  const trustIcon =
    trustGrade === "committee_grade" ? "✓" :
    trustGrade === "preliminary" ? "~" :
    trustGrade ? "✗" : "?";
  console.log(`\n[${trustIcon}] Trust Grade: ${trustGrade ?? "not run"}`);

  // 2. Evidence coverage
  const coverage = await computeEvidenceCoverage(dealId, bankId).catch(() => null);
  if (coverage) {
    const pct = Math.round(coverage.supportRatio * 100);
    const coverageIcon = pct >= 85 ? "✓" : pct >= 70 ? "~" : "✗";
    console.log(`\n[${coverageIcon}] Evidence Coverage: ${pct}% (${coverage.supportedSections}/${coverage.totalSections} sections)`);
    for (const s of coverage.sectionBreakdown) {
      const icon = s.supported ? "  ✓" : "  ✗";
      console.log(`${icon} ${s.sectionKey}: ${s.evidenceCount} row${s.evidenceCount !== 1 ? "s" : ""}`);
    }
  } else {
    console.log(`\n[?] Evidence Coverage: no memo generated yet`);
  }

  // 3. Memo build + lint
  const memoResult = await buildCanonicalCreditMemo({ dealId, bankId }).catch(() => null);
  if (memoResult?.ok) {
    const lint = lintCanonicalMemo(memoResult.memo);
    const lintIcon = lint.passed ? "✓" : "✗";
    console.log(`\n[${lintIcon}] Memo Lint: ${lint.passed ? "PASS" : "FAIL"} (${lint.errorCount} errors, ${lint.warningCount} warnings)`);
    if (lint.issues.length > 0) {
      for (const issue of lint.issues) {
        const icon = issue.severity === "error" ? "  ✗" : "  ⚠";
        console.log(`${icon} [${issue.section}] ${issue.message}`);
      }
    }

    // 4. Committee certification
    const cert = (memoResult.memo as any).committee_certification ?? (memoResult.memo as any).certification;
    if (cert) {
      const certIcon = cert.isCommitteeEligible ? "✓" : "✗";
      console.log(`\n[${certIcon}] Committee Eligible: ${cert.isCommitteeEligible ? "YES" : "NO"}`);
      if (!cert.isCommitteeEligible) {
        const blockers: string[] = cert.reasonsBlocked ?? cert.blockers ?? [];
        for (const b of blockers) {
          console.log(`     • ${b}`);
        }
      }
      if (cert.evidenceSupportRatio !== null && cert.evidenceSupportRatio !== undefined) {
        console.log(`     Evidence: ${Math.round(cert.evidenceSupportRatio * 100)}%`);
      }
    }
  } else {
    console.log(`\n[✗] Memo build failed`);
  }

  // 5. Golden set check
  const goldenCase = GOLDEN_SET.find(
    c => c.id === dealId ||
    (c.subject.company_name && !c.subject.company_name.startsWith("POPULATE") && c.subject.company_name === dealId)
  );
  if (goldenCase) {
    console.log(`\n[★] Golden Set Match: ${goldenCase.name}`);
    console.log(`     Expected trust: ${goldenCase.expected.maxTrustGrade}`);
    console.log(`     Expected committee: ${goldenCase.expected.memoShouldBeCommitteeEligible}`);
    console.log(`     Note: ${goldenCase.expected.notes}`);
  }

  console.log(`\n${divider}\n`);
}

const [,, dealId, bankId] = process.argv;
if (!dealId || !bankId) {
  console.error("Usage: npx tsx auditMemo.ts <dealId> <bankId>");
  console.error("   or: npm run audit:memo <dealId> <bankId>");
  process.exit(1);
}

auditMemo(dealId, bankId).catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
```

**File: `package.json`**

Add to the `scripts` section:
```json
"audit:memo": "npx tsx src/lib/research/evals/auditMemo.ts"
```

---

## TypeScript Check

After ALL sprints are complete:

```bash
npx tsc --noEmit 2>&1 | grep -v "pdf/route.ts"
```

Zero new errors required before committing.

---

## Commit Message

```
feat(phase-82): Proof of Truth — evidence coverage metric + gate + inference surfacing

Sprint 1: evidenceCoverage.ts — section-level support ratio from research_trace_json
Sprint 2: CommitteeCertification extended with evidenceSupportRatio + unsupportedSections
Sprint 3: Gate 9 evidence coverage in completionGate.ts + runMission.ts wired
Sprint 4: EvidenceTag extended with inference-dominated section labeling
Sprint 5: computeContradictionStrength — quality scoring via thread source types
Sprint 6: goldenSet.ts expanded to 20 cases (14 placeholders + POPULATE instructions)
Sprint 7: auditMemo.ts CLI + npm run audit:memo script

Also: supabase/migrations/README.md — documents migration drift,
establishes apply_migration-only workflow going forward.

NOTE: Uses section-level evidence counts from existing research_trace_json.
No sentence-level NLP claim matching built — that was ChatGPT's misframing.
```

---

## Implementation Order (strict)

1. `supabase/migrations/README.md` — Task 1 complete
2. `src/lib/research/evidenceCoverage.ts` — new file
3. `src/lib/creditMemo/canonical/types.ts` — extend CommitteeCertification
4. `src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts` — compute and populate coverage
5. `src/components/creditMemo/CanonicalMemoTemplate.tsx` — banner + EvidenceTag extension
6. `src/lib/research/completionGate.ts` — Gate 9 + contradiction strength
7. `src/lib/research/runMission.ts` — pass evidenceSupportRatio to gate
8. `src/app/api/deals/[dealId]/research/evidence/route.ts` — add sectionStats
9. `src/lib/research/evals/goldenSet.ts` — expand to 20 cases
10. `src/lib/research/evals/runGoldenSetEval.ts` — add evidenceSupportRatio
11. `src/lib/research/evals/auditMemo.ts` — new CLI file
12. `package.json` — add audit:memo script
13. `npx tsc --noEmit` — zero errors
14. Commit and push
