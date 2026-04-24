# Sprint 4 — LMA + Lender Provisioning + Lender Portal Shell

**Status:** Specification — ready for implementation
**Depends on:** Sprint 1 (tenant model)
**Blocks:** Sprints 5, 6 (marketplace and bidding depend on signed LMAs + lender tenants existing)
**References:** [brokerage-master-plan.md](./brokerage-master-plan.md) §9, §10

---

## Purpose

Make participating lenders real tenants on the Buddy platform, with signed Lender Marketplace Agreements on file, and build the shell of the lender portal they'll use. This sprint ends with: three-ish lenders provisioned, each with a Clerk org, each with a signed LMA row in the database, each able to log into `/lender/listings` (which shows an empty queue until Sprint 5 starts generating listings).

---

## What the LMA is

A legal contract between Buddy and each participating lender. It establishes:

1. **Fee structure** — 1% of funded amount (founding cohort) or 1.25% (post-founding), payable via Stripe at loan funding.
2. **Rate card acceptance** — lender commits to the Buddy rate card for every claim they make. No per-deal rate negotiation.
3. **Anti-circumvention** — prohibition on identifying borrowers from marketplace listings, contacting non-picking borrowers, or using marketplace data for out-of-platform origination. Liquidated damages for violation.
4. **Data handling** — GLBA pass-through obligations on borrower data received post-pick.
5. **SBA eligibility certification** — lender certifies they are SBA-eligible participating lender in good standing.
6. **E&O insurance** — minimum coverage requirements.
7. **Closing commitment honor** — when a lender claims a deal with a stated closing timeline, they commit to honor it. Repeated missed timelines = marketplace termination.
8. **Versioning + re-signing** — LMA has a version. Major changes require lenders to re-sign before their next claim.

**Drafting the legal document is out of scope for this sprint** — that's counsel's job. This sprint builds the infrastructure that tracks signing, enforces gate access, and versions agreements.

---

## Database

### Migration: `supabase/migrations/20260428_lender_marketplace.sql`

```sql
-- ============================================================================
-- Sprint 4: Lender Marketplace Agreement + Lender Infrastructure
-- ============================================================================

-- 1) Legal document registry (LMA versions, future agreements).
CREATE TABLE IF NOT EXISTS public.legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type text NOT NULL CHECK (doc_type IN ('lma', 'borrower_agreement', 'other')),
  version text NOT NULL,              -- semver, e.g. "1.0.0"
  title text NOT NULL,
  pdf_storage_path text NOT NULL,     -- Supabase Storage path to the signed PDF template
  content_hash text NOT NULL,         -- SHA-256 of the PDF for integrity
  effective_date date NOT NULL,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX legal_documents_doc_type_version_idx
  ON public.legal_documents (doc_type, version);

-- 2) Lender marketplace agreements — one row per lender per LMA version they signed.
CREATE TABLE IF NOT EXISTS public.lender_marketplace_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_bank_id uuid NOT NULL REFERENCES public.banks(id),
  legal_document_id uuid NOT NULL REFERENCES public.legal_documents(id),
  signed_at timestamptz NOT NULL,
  signed_by_name text NOT NULL,
  signed_by_title text NOT NULL,
  signed_pdf_storage_path text NOT NULL,   -- countersigned PDF stored in Supabase Storage
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated', 'superseded')),
  terminated_at timestamptz,
  terminated_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lender_marketplace_agreements_lender_bank_id_idx
  ON public.lender_marketplace_agreements (lender_bank_id);
CREATE INDEX lender_marketplace_agreements_status_idx
  ON public.lender_marketplace_agreements (status);

ALTER TABLE public.lender_marketplace_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY lma_select_for_bank_members
  ON public.lender_marketplace_agreements FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = lender_marketplace_agreements.lender_bank_id
      AND m.user_id = auth.uid()
  ));
-- Also grant brokerage ops read-access (they need to see all LMAs).
CREATE POLICY lma_select_for_brokerage_ops
  ON public.lender_marketplace_agreements FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    JOIN public.banks b ON b.id = m.bank_id
    WHERE m.user_id = auth.uid() AND b.bank_kind = 'brokerage'
  ));

-- 3) Marketplace audit log — append-only, immutable.
CREATE TABLE IF NOT EXISTS public.marketplace_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,           -- 'listing_viewed', 'claim_attempted', 'claim_succeeded', 'claim_released', 'bid_won', 'bid_lost', 'package_downloaded', 'borrower_picked'
  listing_id uuid,                    -- references marketplace_listings (Sprint 5)
  deal_id uuid,                       -- references deals
  lender_bank_id uuid REFERENCES public.banks(id),
  borrower_session_token text,        -- if event is borrower-side
  actor_user_id uuid,                 -- Clerk user id
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX marketplace_audit_log_listing_id_idx ON public.marketplace_audit_log (listing_id);
CREATE INDEX marketplace_audit_log_deal_id_idx ON public.marketplace_audit_log (deal_id);
CREATE INDEX marketplace_audit_log_lender_bank_id_idx ON public.marketplace_audit_log (lender_bank_id);
CREATE INDEX marketplace_audit_log_event_at_idx ON public.marketplace_audit_log (event_at);

-- Append-only: disallow UPDATE and DELETE.
ALTER TABLE public.marketplace_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select_brokerage_ops
  ON public.marketplace_audit_log FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    JOIN public.banks b ON b.id = m.bank_id
    WHERE m.user_id = auth.uid() AND b.bank_kind = 'brokerage'
  ));

CREATE POLICY audit_log_select_lender_own_events
  ON public.marketplace_audit_log FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = marketplace_audit_log.lender_bank_id
      AND m.user_id = auth.uid()
  ));

CREATE POLICY audit_log_insert_any_authenticated
  ON public.marketplace_audit_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- No UPDATE or DELETE policies → rows cannot be modified or removed.

-- 4) Seed LMA v1.0.0 (placeholder — real PDF uploaded post-counsel-review).
-- Insert LMA record so lenders can sign v1.0.0 before counsel finalizes content.
-- content_hash is computed at upload time; update once real PDF is stored.
INSERT INTO public.legal_documents
  (doc_type, version, title, pdf_storage_path, content_hash, effective_date)
VALUES
  ('lma', '1.0.0', 'Buddy Lender Marketplace Agreement v1.0.0',
   'legal/lma-v1.0.0-placeholder.pdf',
   'PLACEHOLDER_HASH_UPDATE_ON_REAL_UPLOAD',
   current_date)
ON CONFLICT (doc_type, version) DO NOTHING;
```

---

## Code

### Middleware: require signed LMA for lender tenant access to marketplace

New helper: `src/lib/brokerage/requireLenderMarketplaceAccess.ts`

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function requireLenderMarketplaceAccess(
  lenderBankId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("lender_marketplace_agreements")
    .select("id, legal_document_id, status")
    .eq("lender_bank_id", lenderBankId)
    .eq("status", "active");

  if (!data || data.length === 0) {
    return { ok: false, reason: "no active LMA on file" };
  }

  // Verify at least one active LMA references the current LMA version.
  const { data: currentLMA } = await sb
    .from("legal_documents")
    .select("id")
    .eq("doc_type", "lma")
    .is("superseded_at", null)
    .order("effective_date", { ascending: false })
    .limit(1)
    .single();

  if (!currentLMA) return { ok: false, reason: "no active LMA version published" };

  const hasCurrent = data.some((r) => r.legal_document_id === currentLMA.id);
  if (!hasCurrent) {
    return { ok: false, reason: "LMA version out of date — re-signing required" };
  }

  return { ok: true };
}
```

Every lender-scoped API route (Sprints 5 and 6 will add several) calls this gate before returning data.

### Admin provisioning route: `POST /api/admin/brokerage/lenders`

Creates a new lender tenant in a single transaction:

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBrokerageOpsAuth } from "@/lib/auth/brokerageOps";

export async function POST(req: NextRequest) {
  const ops = await requireBrokerageOpsAuth();
  if (!ops.ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    lenderName,
    code,                  // short code, e.g. "LIVE_OAK"
    clerkOrgId,            // must be created in Clerk first (manual for now)
    firstUserId,           // Clerk user id of the lender's first user
    lenderProgram,         // { minDscr, maxLtv, assetTypes, geography, sbaOnly, scoreThreshold }
    lmaSignedByName,
    lmaSignedByTitle,
    lmaSignedPdfStoragePath,
  } = body;

  const sb = supabaseAdmin();

  // 1. Create banks row (lender tenant).
  const { data: newBank } = await sb
    .from("banks")
    .insert({
      code,
      name: lenderName,
      bank_kind: "commercial_bank",
      is_sandbox: false,
    })
    .select("id")
    .single();

  // 2. Add the first user as owner of this tenant.
  await sb.from("bank_user_memberships").insert({
    bank_id: newBank.id,
    user_id: firstUserId,
    role: "owner",
  });

  // 3. Record lender program.
  await sb.from("lender_programs").insert({
    bank_id: newBank.id,
    lender_name: lenderName,
    ...lenderProgram,
  });

  // 4. Record signed LMA.
  const { data: currentLMA } = await sb
    .from("legal_documents")
    .select("id")
    .eq("doc_type", "lma")
    .is("superseded_at", null)
    .order("effective_date", { ascending: false })
    .limit(1)
    .single();

  await sb.from("lender_marketplace_agreements").insert({
    lender_bank_id: newBank.id,
    legal_document_id: currentLMA.id,
    signed_at: new Date().toISOString(),
    signed_by_name: lmaSignedByName,
    signed_by_title: lmaSignedByTitle,
    signed_pdf_storage_path: lmaSignedPdfStoragePath,
    status: "active",
  });

  return NextResponse.json({ ok: true, lenderBankId: newBank.id });
}
```

`requireBrokerageOpsAuth` is a new helper that verifies the caller is a member of the Buddy Brokerage tenant with `role: 'owner'`.

### Lender portal shell

New routes (shell only — real content in Sprints 5 and 6):

- `/lender/listings/page.tsx` — empty queue with "No active listings yet" placeholder
- `/lender/claims/page.tsx` — empty
- `/lender/deals/page.tsx` — empty

All protected by Clerk auth, all verify `lender_marketplace_agreements` active status via `requireLenderMarketplaceAccess`.

### Admin UI shell

- `/admin/brokerage/lenders` — list all lender tenants, show LMA status, button to provision new (calls POST route above)
- `/admin/brokerage/listings` — placeholder for Sprint 5

Gated behind brokerage-ops Clerk membership.

---

## Manual provisioning runbook

For the first cohort, each lender provisioning is manual:

1. **Counsel reviews LMA** → final PDF uploaded to Supabase Storage at `legal/lma-v1.0.0.pdf`. Update `legal_documents.content_hash` to match the real SHA-256.
2. **DocuSign / counterpart signing** — send the LMA to the lender. Lender signs. Countersigned PDF uploaded to Supabase Storage at `legal/lma-signed/{lenderCode}-v1.0.0.pdf`.
3. **Create Clerk org** — new Clerk organization for the lender, name matches `banks.name`.
4. **Invite first user** — lender's designated marketplace user gets a Clerk invite.
5. **Call POST `/api/admin/brokerage/lenders`** with the provisioning payload.
6. **Verify** — query DB: confirm `banks` row exists with `bank_kind='commercial_bank'`, `bank_user_memberships` row exists, `lender_programs` row exists, `lender_marketplace_agreements` row exists with `status='active'`.
7. **Send lender welcome email** with `/lender/listings` URL.

Target: 3-5 lenders provisioned before Sprint 5 ships.

---

## Acceptance criteria

1. Migrations applied. `legal_documents`, `lender_marketplace_agreements`, `marketplace_audit_log` tables exist with RLS as specified.
2. LMA v1.0.0 record seeded (placeholder PDF path until counsel finalizes).
3. `requireLenderMarketplaceAccess` returns `{ok:true}` for lenders with active LMA on current version, returns `{ok:false, reason}` otherwise.
4. Admin provisioning route creates a full lender tenant in one transactional call, populates all required tables.
5. Lender portal shell renders at `/lender/listings` with "No active listings" placeholder for a logged-in lender; blocks unauthenticated access.
6. Brokerage ops admin page shows provisioned lenders with LMA status.
7. `marketplace_audit_log` cannot be UPDATE'd or DELETE'd — verify by attempting and getting a policy violation.
8. At least one test lender is provisioned end-to-end via the runbook, can log in, can navigate `/lender/*` shell.

---

## Test plan

- **Migration:** run on branch, verify all four tables, indexes, RLS policies exist.
- **Integration:** provision a test lender via the admin route; confirm all related rows created; confirm lender user can log in and see empty portal.
- **RLS:** lender A cannot see lender B's LMA via `SELECT * FROM lender_marketplace_agreements` — should return only their own.
- **Audit log immutability:** attempt `UPDATE marketplace_audit_log SET ...` or `DELETE` — expect policy violation.

---

## Non-goals

- Self-serve lender signup (future — when LMA is stable + first cohort succeeds).
- Automated LMA sending via DocuSign API (future integration).
- Lender portal real content (Sprints 5 and 6).
- LMA version bumps + re-signing flow (future — build when we need to update LMA for the first time).

---

## Notes for implementer

- Counsel engagement is a parallel workstream. Don't wait for the final LMA PDF to ship the infrastructure — placeholder row is fine. Update `content_hash` and `pdf_storage_path` when the real document is ready.
- The provisioning admin route should be idempotent on `code` — if a lender with that code exists, either update or return an error. Matt prefers error-on-conflict so mistakes don't silently clobber.
- Audit log is append-only at the policy level, but also surface this rule in documentation for whoever writes the ops queries. Surprising policy violations are frustrating.
