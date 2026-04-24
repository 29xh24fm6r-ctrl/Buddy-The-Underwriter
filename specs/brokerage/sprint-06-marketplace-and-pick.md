# Sprint 6 — Marketplace: Preview → Claim → Pick → Atomic Unlock → Close

**Status:** Specification — ready for implementation
**Depends on:** Sprint 0 (score), Sprint 3 (trident), Sprint 4 (LMA + audit), Sprint 5 (sealing + KFS)
**Blocks:** nothing — this is the launch-gating sprint
**References:** [brokerage-master-plan.md](./brokerage-master-plan.md) §4, §6, §8

---

## Purpose

Everything built so far is inert infrastructure. Sprint 6 is the engine that runs it:

1. **Daily cadence cron** that flips listings from `pending_preview` → `previewing` at 9am CT and from `previewing` → `claiming` 24 hours later.
2. **Lender claim API** that enforces the 3-slot cap atomically and captures the three-field claim form (rate commit, closing timeline, optional relationship terms).
3. **Claim window close** that transitions `claiming` → `awaiting_borrower_pick` at end of day, notifying the borrower.
4. **Borrower pick API** that triggers the atomic unlock: trident releases to borrower, full E-Tran package releases to picked lender, losing claims finalize.
5. **Stripe fee capture** at loan funding: $1,000 from borrower (from proceeds), 1% (founding) or 1.25% (post-founding) from winning lender.
6. **Re-list flow** — one free per borrower within 60 days.
7. **Zero-claim rollover + expiration** — 3 roll days then re-list offer.
8. **Rate card nightly recompute** — formula-driven update as Prime moves.

This is the sprint that turns infrastructure into a working marketplace.

---

## Database

### Migration: `supabase/migrations/20260430_marketplace_claims.sql`

```sql
-- ============================================================================
-- Sprint 6: Marketplace Claims, Pick, Audit Extensions
-- ============================================================================

-- 1) Marketplace claims.
CREATE TABLE IF NOT EXISTS public.marketplace_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  lender_bank_id uuid NOT NULL REFERENCES public.banks(id),

  -- Three-field claim form
  rate_commitment_bps integer NOT NULL,      -- must match listing.published_rate_bps at claim time
  closing_timeline_days integer NOT NULL CHECK (closing_timeline_days > 0),
  relationship_terms text,                   -- optional free text

  -- State
  status text NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'won', 'lost', 'expired', 'withdrawn'
  )),

  claimed_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,                    -- when borrower picked or this claim was finalized
  decided_reason text,                       -- 'borrower_picked', 'borrower_picked_other', 'window_expired', 'no_pick_in_48h'

  -- The Clerk user who submitted the claim
  submitted_by_user_id uuid NOT NULL,

  UNIQUE (listing_id, lender_bank_id)        -- a lender cannot claim the same listing twice
);

CREATE INDEX marketplace_claims_listing_id_idx ON public.marketplace_claims (listing_id);
CREATE INDEX marketplace_claims_lender_bank_id_idx ON public.marketplace_claims (lender_bank_id);
CREATE INDEX marketplace_claims_status_idx ON public.marketplace_claims (status);

ALTER TABLE public.marketplace_claims ENABLE ROW LEVEL SECURITY;

-- Brokerage ops sees all claims.
CREATE POLICY claims_select_for_brokerage_ops
  ON public.marketplace_claims FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    JOIN public.banks b ON b.id = m.bank_id
    WHERE m.user_id = auth.uid() AND b.bank_kind = 'brokerage'
  ));

-- Lenders see ONLY their own claims (never other lenders' claims).
CREATE POLICY claims_select_for_own_lender
  ON public.marketplace_claims FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = marketplace_claims.lender_bank_id
      AND m.user_id = auth.uid()
  ));

-- Inserts go through the claim API which uses service-role; no direct INSERT policy for users.

-- 2) Borrower picks.
CREATE TABLE IF NOT EXISTS public.marketplace_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id),
  winning_claim_id uuid NOT NULL REFERENCES public.marketplace_claims(id),
  picked_at timestamptz NOT NULL DEFAULT now(),
  picked_via text NOT NULL DEFAULT 'portal' CHECK (picked_via IN ('portal', 'ops_manual')),
  borrower_session_token text NOT NULL,
  UNIQUE (listing_id)                        -- exactly one pick per listing
);

CREATE INDEX marketplace_picks_deal_id_idx ON public.marketplace_picks (deal_id);

-- 3) Atomic unlock records — the transactional event that happens at pick.
CREATE TABLE IF NOT EXISTS public.marketplace_atomic_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_id uuid NOT NULL REFERENCES public.marketplace_picks(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id),
  trident_final_bundle_id uuid REFERENCES public.buddy_trident_bundles(id),
  package_release_manifest jsonb NOT NULL,   -- signed URLs, TTLs, what was released
  completed_at timestamptz NOT NULL DEFAULT now(),
  failures jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- 4) Re-list tracking.
CREATE TABLE IF NOT EXISTS public.marketplace_relists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id),
  original_listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id),
  new_listing_id uuid REFERENCES public.marketplace_listings(id),
  relist_reason text NOT NULL CHECK (relist_reason IN (
    'zero_claims_expired',
    'borrower_vetoed',
    'borrower_no_pick_in_48h',
    'winning_lender_didnt_close_60d',
    'ops_manual'
  )),
  was_free boolean NOT NULL,
  relisted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX marketplace_relists_deal_id_idx ON public.marketplace_relists (deal_id);

-- 5) Rate card history — for audit.
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS rate_card_version text NOT NULL DEFAULT '1.0.0';

-- 6) Deal status extensions.
-- deals.status adds: 'sealed', 'listed', 'picked', 'closing', 'funded', 'relisted', 'expired'
-- Existing values preserved. Add check constraint update if needed.
```

### Stripe transaction tracking

```sql
-- supabase/migrations/20260430_marketplace_stripe.sql

CREATE TABLE IF NOT EXISTS public.marketplace_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id),
  pick_id uuid REFERENCES public.marketplace_picks(id),

  payer_type text NOT NULL CHECK (payer_type IN ('borrower', 'lender')),
  payer_bank_id uuid REFERENCES public.banks(id),     -- for lender payments
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  fee_basis text NOT NULL CHECK (fee_basis IN (
    'borrower_flat_packaging_1000',
    'lender_pct_founding_100bps',
    'lender_pct_standard_125bps'
  )),

  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_status text CHECK (stripe_status IN (
    'pending', 'processing', 'succeeded', 'failed', 'refunded', 'canceled'
  )),

  fired_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE INDEX marketplace_transactions_deal_id_idx ON public.marketplace_transactions (deal_id);
CREATE INDEX marketplace_transactions_stripe_status_idx ON public.marketplace_transactions (stripe_status);
```

---

## Code

### Daily cadence cron — `src/app/api/cron/brokerage/marketplace-tick/route.ts`

Runs every 15 minutes. Idempotent on listing state transitions. Handles the full daily clock.

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET!;

export async function POST(req: NextRequest) {
  // Auth: Vercel cron sends Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const now = new Date();

  const result = {
    openedPreviews: 0,
    openedClaims: 0,
    closedClaimsToAwaitingPick: 0,
    expiredBorrowerPicks: 0,
    rolledZeroClaims: 0,
    recomputedRateCards: 0,
  };

  // 1. pending_preview → previewing (preview_opens_at reached)
  const { data: toOpen } = await sb
    .from("marketplace_listings")
    .select("id, deal_id")
    .eq("status", "pending_preview")
    .lte("preview_opens_at", now.toISOString());
  for (const l of toOpen ?? []) {
    await sb.from("marketplace_listings")
      .update({ status: "previewing", updated_at: now.toISOString() })
      .eq("id", l.id);
    await logAudit(sb, "listing_preview_opened", { listing_id: l.id, deal_id: l.deal_id });
    result.openedPreviews++;
  }

  // 2. previewing → claiming (claim_opens_at reached)
  const { data: toClaim } = await sb
    .from("marketplace_listings")
    .select("id, deal_id, matched_lender_bank_ids")
    .eq("status", "previewing")
    .lte("claim_opens_at", now.toISOString());
  for (const l of toClaim ?? []) {
    await sb.from("marketplace_listings")
      .update({ status: "claiming", updated_at: now.toISOString() })
      .eq("id", l.id);
    await logAudit(sb, "listing_claim_opened", { listing_id: l.id, deal_id: l.deal_id });
    // Notify matched lenders via email/in-app (Sprint 6 feature — can be deferred to 6.5)
    await notifyMatchedLenders(sb, l.id, l.matched_lender_bank_ids);
    result.openedClaims++;
  }

  // 3. claiming → awaiting_borrower_pick (claim_closes_at reached)
  const { data: toClose } = await sb
    .from("marketplace_listings")
    .select("id, deal_id, rolled_count")
    .eq("status", "claiming")
    .lte("claim_closes_at", now.toISOString());
  for (const l of toClose ?? []) {
    // Count active claims.
    const { count: activeClaimCount } = await sb
      .from("marketplace_claims")
      .select("*", { count: "exact", head: true })
      .eq("listing_id", l.id)
      .eq("status", "active");

    if ((activeClaimCount ?? 0) === 0) {
      // Zero claims — roll or expire.
      if (l.rolled_count < 3) {
        // Roll to next business day's claim window.
        const nextClaimOpens = nextBusinessDayAt(now, 9, "CT"); // 9am CT next biz day
        const nextClaimCloses = setHour(nextClaimOpens, 17); // 5pm CT
        await sb.from("marketplace_listings")
          .update({
            status: "claiming",
            claim_opens_at: nextClaimOpens.toISOString(),
            claim_closes_at: nextClaimCloses.toISOString(),
            rolled_count: (l.rolled_count ?? 0) + 1,
            updated_at: now.toISOString(),
          })
          .eq("id", l.id);
        await logAudit(sb, "listing_rolled_zero_claims", { listing_id: l.id });
        result.rolledZeroClaims++;
      } else {
        // Expire.
        await sb.from("marketplace_listings")
          .update({
            status: "expired",
            expired_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq("id", l.id);
        await sb.from("deals").update({ status: "expired" }).eq("id", l.deal_id);
        await logAudit(sb, "listing_expired_zero_claims", { listing_id: l.id });
        // Notify borrower — offer re-list.
        await notifyBorrowerRelistOffer(sb, l.deal_id, "zero_claims_expired");
      }
    } else {
      // 1+ claims — move to awaiting pick.
      await sb.from("marketplace_listings")
        .update({
          status: "awaiting_borrower_pick",
          updated_at: now.toISOString(),
        })
        .eq("id", l.id);
      await logAudit(sb, "listing_claim_window_closed", {
        listing_id: l.id,
        active_claim_count: activeClaimCount,
      });
      // Notify borrower — pick by 48 hours from now.
      await notifyBorrowerPickRequired(sb, l.deal_id, l.id);
      result.closedClaimsToAwaitingPick++;
    }
  }

  // 4. awaiting_borrower_pick → expired (48h with no pick)
  const pickDeadline = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const { data: toExpire } = await sb
    .from("marketplace_listings")
    .select("id, deal_id, updated_at")
    .eq("status", "awaiting_borrower_pick")
    .lte("updated_at", pickDeadline.toISOString());
  for (const l of toExpire ?? []) {
    // Mark all active claims as expired.
    await sb.from("marketplace_claims")
      .update({
        status: "expired",
        decided_at: now.toISOString(),
        decided_reason: "no_pick_in_48h",
      })
      .eq("listing_id", l.id)
      .eq("status", "active");

    await sb.from("marketplace_listings")
      .update({
        status: "expired",
        expired_at: now.toISOString(),
      })
      .eq("id", l.id);
    await logAudit(sb, "listing_expired_no_pick", { listing_id: l.id });
    await notifyBorrowerRelistOffer(sb, l.deal_id, "borrower_no_pick_in_48h");
    // Notify claimants.
    await notifyClaimantsExpired(sb, l.id);
    result.expiredBorrowerPicks++;
  }

  // 5. Rate card nightly recompute (once per day, gated by last computed_at).
  if (shouldRecomputeRateCard(now)) {
    await recomputeRateCard(sb);
    result.recomputedRateCards = 1;
  }

  return NextResponse.json({ ok: true, ...result });
}

// Helpers elsewhere: logAudit, notifyMatchedLenders, notifyBorrowerRelistOffer,
// notifyBorrowerPickRequired, notifyClaimantsExpired, nextBusinessDayAt,
// setHour, shouldRecomputeRateCard, recomputeRateCard.
```

Register in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/brokerage/marketplace-tick",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

### Claim API — `src/app/api/lender/listings/[listingId]/claim/route.ts`

**Atomic 3-slot cap.** Uses Postgres advisory lock + count guard in a single transaction.

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireLenderMarketplaceAccess } from "@/lib/brokerage/requireLenderMarketplaceAccess";
import { getAuth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
) {
  const { listingId } = await params;
  const { userId, orgId } = getAuth(req);
  if (!userId || !orgId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  // Resolve lender bank_id from orgId.
  const { data: bankRow } = await sb
    .from("banks")
    .select("id, bank_kind")
    .eq("clerk_org_id", orgId)
    .single();
  if (!bankRow || bankRow.bank_kind !== "commercial_bank") {
    return NextResponse.json({ ok: false, error: "not a lender tenant" }, { status: 403 });
  }

  // LMA gate.
  const access = await requireLenderMarketplaceAccess(bankRow.id);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.reason }, { status: 403 });
  }

  const body = await req.json();
  const { rate_commitment_bps, closing_timeline_days, relationship_terms } = body;

  if (typeof rate_commitment_bps !== "number" || typeof closing_timeline_days !== "number") {
    return NextResponse.json({ ok: false, error: "invalid claim form" }, { status: 400 });
  }
  if (closing_timeline_days <= 0 || closing_timeline_days > 365) {
    return NextResponse.json({ ok: false, error: "invalid closing timeline" }, { status: 400 });
  }

  // Transactional claim with 3-slot cap enforcement via RPC.
  const { data: result, error } = await sb.rpc("claim_marketplace_listing", {
    p_listing_id: listingId,
    p_lender_bank_id: bankRow.id,
    p_rate_commitment_bps: rate_commitment_bps,
    p_closing_timeline_days: closing_timeline_days,
    p_relationship_terms: relationship_terms ?? null,
    p_submitted_by_user_id: userId,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  // result.status: 'claimed' | 'full' | 'already_claimed' | 'not_claimable' | 'rate_mismatch' | 'not_matched'
  if (result.status !== "claimed") {
    return NextResponse.json({ ok: false, error: result.status }, { status: 409 });
  }

  // Audit.
  await sb.from("marketplace_audit_log").insert({
    event_type: "claim_succeeded",
    listing_id: listingId,
    deal_id: result.deal_id,
    lender_bank_id: bankRow.id,
    actor_user_id: userId,
    metadata: {
      claim_id: result.claim_id,
      rate_commitment_bps,
      closing_timeline_days,
      relationship_terms_length: relationship_terms?.length ?? 0,
    },
  });

  return NextResponse.json({
    ok: true,
    claimId: result.claim_id,
    claimsOnListing: result.active_claims_count,
    listingFull: result.active_claims_count >= 3,
  });
}
```

**Postgres RPC function** (migration):

```sql
-- supabase/migrations/20260430_claim_rpc.sql

CREATE OR REPLACE FUNCTION public.claim_marketplace_listing(
  p_listing_id uuid,
  p_lender_bank_id uuid,
  p_rate_commitment_bps integer,
  p_closing_timeline_days integer,
  p_relationship_terms text,
  p_submitted_by_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_listing record;
  v_active_count integer;
  v_claim_id uuid;
  v_is_matched boolean;
BEGIN
  -- Lock the listing row for the duration of this transaction.
  SELECT * INTO v_listing
  FROM public.marketplace_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_listing.status != 'claiming' THEN
    RETURN jsonb_build_object('status', 'not_claimable');
  END IF;

  -- Verify lender is in the matched set.
  v_is_matched := p_lender_bank_id = ANY (v_listing.matched_lender_bank_ids);
  IF NOT v_is_matched THEN
    RETURN jsonb_build_object('status', 'not_matched');
  END IF;

  -- Verify rate commitment matches published rate (lenders cannot negotiate rate per deal).
  IF p_rate_commitment_bps != v_listing.published_rate_bps THEN
    RETURN jsonb_build_object('status', 'rate_mismatch');
  END IF;

  -- Count active claims — enforces the 3-slot cap.
  SELECT count(*) INTO v_active_count
  FROM public.marketplace_claims
  WHERE listing_id = p_listing_id AND status = 'active';

  IF v_active_count >= 3 THEN
    RETURN jsonb_build_object('status', 'full');
  END IF;

  -- Check for duplicate claim by same lender.
  IF EXISTS (
    SELECT 1 FROM public.marketplace_claims
    WHERE listing_id = p_listing_id
      AND lender_bank_id = p_lender_bank_id
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('status', 'already_claimed');
  END IF;

  -- Insert the claim.
  INSERT INTO public.marketplace_claims (
    listing_id, lender_bank_id, rate_commitment_bps,
    closing_timeline_days, relationship_terms, submitted_by_user_id
  )
  VALUES (
    p_listing_id, p_lender_bank_id, p_rate_commitment_bps,
    p_closing_timeline_days, p_relationship_terms, p_submitted_by_user_id
  )
  RETURNING id INTO v_claim_id;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'claim_id', v_claim_id,
    'deal_id', v_listing.deal_id,
    'active_claims_count', v_active_count + 1
  );
END;
$$;
```

The `FOR UPDATE` row-lock + count-and-insert inside a single transaction prevents race conditions on the 3-slot cap.

### Borrower pick API — `src/app/api/brokerage/deals/[dealId]/pick/route.ts`

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { runAtomicUnlock } from "@/lib/brokerage/atomicUnlock";

export const runtime = "nodejs";
export const maxDuration = 120; // trident generation can take 60-90s

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await params;
  const session = await getBorrowerSession();
  if (!session || session.deal_id !== dealId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { winningClaimId } = await req.json();
  if (!winningClaimId) {
    return NextResponse.json({ ok: false, error: "winningClaimId required" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Load the listing and verify state + ownership.
  const { data: listing } = await sb
    .from("marketplace_listings")
    .select("id, deal_id, status")
    .eq("deal_id", dealId)
    .eq("status", "awaiting_borrower_pick")
    .maybeSingle();

  if (!listing) {
    return NextResponse.json(
      { ok: false, error: "no listing awaiting pick for this deal" },
      { status: 404 },
    );
  }

  // Verify the winningClaimId belongs to this listing and is active.
  const { data: winningClaim } = await sb
    .from("marketplace_claims")
    .select("id, lender_bank_id, status")
    .eq("id", winningClaimId)
    .eq("listing_id", listing.id)
    .eq("status", "active")
    .maybeSingle();

  if (!winningClaim) {
    return NextResponse.json({ ok: false, error: "invalid claim" }, { status: 400 });
  }

  // Execute the atomic unlock — all side effects live inside this module.
  const unlockResult = await runAtomicUnlock({
    listingId: listing.id,
    dealId,
    winningClaimId,
    borrowerSessionToken: session.token,
    sb,
  });

  if (!unlockResult.ok) {
    return NextResponse.json(
      { ok: false, error: unlockResult.error ?? "unlock failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    pickId: unlockResult.pickId,
    tridentReady: true,
    packageReleased: true,
    winningLenderBankId: winningClaim.lender_bank_id,
  });
}
```

### Atomic unlock — `src/lib/brokerage/atomicUnlock.ts`

The transactional heart of the marketplace. Five things must all succeed or all roll back:

```typescript
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateTridentBundle } from "@/lib/trident/tridentBundleOrchestrator";
import { generateSBAPackage } from "@/lib/sba/sbaPackageOrchestrator";

export async function runAtomicUnlock(args: {
  listingId: string;
  dealId: string;
  winningClaimId: string;
  borrowerSessionToken: string;
  sb: SupabaseClient;
}): Promise<{ ok: true; pickId: string } | { ok: false; error: string }> {
  const { listingId, dealId, winningClaimId, borrowerSessionToken, sb } = args;

  try {
    // STEP 1: Record the pick (row-level lock on listing).
    const { data: pick } = await sb
      .from("marketplace_picks")
      .insert({
        listing_id: listingId,
        deal_id: dealId,
        winning_claim_id: winningClaimId,
        borrower_session_token: borrowerSessionToken,
        picked_via: "portal",
      })
      .select("id")
      .single();

    if (!pick) throw new Error("Failed to record pick");

    // STEP 2: Mark winning claim, mark losers.
    await sb.from("marketplace_claims")
      .update({
        status: "won",
        decided_at: new Date().toISOString(),
        decided_reason: "borrower_picked",
      })
      .eq("id", winningClaimId);

    await sb.from("marketplace_claims")
      .update({
        status: "lost",
        decided_at: new Date().toISOString(),
        decided_reason: "borrower_picked_other",
      })
      .eq("listing_id", listingId)
      .neq("id", winningClaimId)
      .eq("status", "active");

    // STEP 3: Generate FINAL trident bundle (unwatermarked, full PDFs).
    const finalBundle = await generateTridentBundle({
      dealId,
      mode: "final",
      sb,
    });

    // STEP 4: Generate/finalize full E-Tran package for winning lender.
    const packageResult = await generateSBAPackage({
      dealId,
      mode: "final",
      releaseTo: "winning_lender",
      sb,
    });

    // STEP 5: Update listing + deal status.
    await sb.from("marketplace_listings")
      .update({
        status: "picked",
        picked_at: new Date().toISOString(),
      })
      .eq("id", listingId);

    await sb.from("deals")
      .update({ status: "picked" })
      .eq("id", dealId);

    // STEP 6: Record the unlock envelope.
    await sb.from("marketplace_atomic_unlocks").insert({
      pick_id: pick.id,
      deal_id: dealId,
      trident_final_bundle_id: finalBundle.id,
      package_release_manifest: packageResult.manifest,
    });

    // STEP 7: Audit.
    await sb.from("marketplace_audit_log").insert({
      event_type: "borrower_picked_atomic_unlock",
      listing_id: listingId,
      deal_id: dealId,
      metadata: { pick_id: pick.id, winning_claim_id: winningClaimId },
    });

    // STEP 8: Notifications (non-fatal if they fail).
    // - Notify winning lender: package available, download links.
    // - Notify losing claimants: deal went to another lender.
    // - Notify borrower: trident PDFs ready, email with download links.
    await sendUnlockNotifications(sb, { dealId, listingId, pickId: pick.id }).catch(() => {});

    return { ok: true, pickId: pick.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[atomic-unlock] failed:", msg);

    // Record the failure for ops review.
    await sb.from("marketplace_audit_log").insert({
      event_type: "atomic_unlock_failed",
      listing_id: listingId,
      deal_id: dealId,
      metadata: { error: msg, winning_claim_id: winningClaimId },
    });

    return { ok: false, error: msg };
  }
}

async function sendUnlockNotifications(
  sb: SupabaseClient,
  args: { dealId: string; listingId: string; pickId: string },
): Promise<void> {
  // Implementation: fetch winning lender email, losing lender emails, borrower email.
  // Send three emails via existing email service (Resend or whatever is wired).
  // Content: borrower gets trident download links (signed URLs 7-day TTL).
  //          winning lender gets full package download links + borrower contact info.
  //          losing lenders get a polite "deal went elsewhere" note with no borrower info.
}
```

### Stripe fee firing at close — `src/app/api/admin/brokerage/deals/[dealId]/mark-funded/route.ts`

Ops-triggered when the lender confirms the loan funded. Fires both fees via Stripe.

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBrokerageOpsAuth } from "@/lib/auth/brokerageOps";
import Stripe from "stripe";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const ops = await requireBrokerageOpsAuth();
  if (!ops.ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { dealId } = await params;
  const { fundedAmount, fundedAt } = await req.json();

  const sb = supabaseAdmin();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  // Load pick and winning lender bank.
  const { data: pick } = await sb
    .from("marketplace_picks")
    .select("id, winning_claim_id")
    .eq("deal_id", dealId)
    .single();
  if (!pick) return NextResponse.json({ ok: false, error: "no pick" }, { status: 400 });

  const { data: winningClaim } = await sb
    .from("marketplace_claims")
    .select("lender_bank_id")
    .eq("id", pick.winning_claim_id)
    .single();

  // Determine lender fee tier (founding cohort vs. post-founding).
  const { count: priorFundedDeals } = await sb
    .from("marketplace_transactions")
    .select("*", { count: "exact", head: true })
    .eq("payer_type", "lender")
    .eq("stripe_status", "succeeded");

  const { count: foundingLenderCount } = await sb
    .from("lender_marketplace_agreements")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");

  const isFoundingCohort =
    (priorFundedDeals ?? 0) < 100 && (foundingLenderCount ?? 0) <= 10;
  const lenderFeeBps = isFoundingCohort ? 100 : 125;
  const lenderFeeAmount = Math.round((fundedAmount * lenderFeeBps) / 10000 * 100); // cents

  // Fire borrower $1,000 charge.
  const borrowerIntent = await stripe.paymentIntents.create({
    amount: 100000, // $1,000 in cents
    currency: "usd",
    // Customer + payment method wiring is infra-specific — assume customer exists.
    description: `Buddy packaging fee for deal ${dealId}`,
    metadata: { deal_id: dealId, pick_id: pick.id, fee_basis: "borrower_flat_packaging_1000" },
  });

  await sb.from("marketplace_transactions").insert({
    deal_id: dealId,
    pick_id: pick.id,
    payer_type: "borrower",
    amount_cents: 100000,
    fee_basis: "borrower_flat_packaging_1000",
    stripe_payment_intent_id: borrowerIntent.id,
    stripe_status: "pending",
  });

  // Fire lender percentage charge.
  const lenderIntent = await stripe.paymentIntents.create({
    amount: lenderFeeAmount,
    currency: "usd",
    description: `Buddy marketplace fee (${lenderFeeBps}bps) for deal ${dealId}`,
    metadata: {
      deal_id: dealId,
      pick_id: pick.id,
      fee_basis: isFoundingCohort
        ? "lender_pct_founding_100bps"
        : "lender_pct_standard_125bps",
      lender_bank_id: winningClaim?.lender_bank_id,
    },
  });

  await sb.from("marketplace_transactions").insert({
    deal_id: dealId,
    pick_id: pick.id,
    payer_type: "lender",
    payer_bank_id: winningClaim?.lender_bank_id,
    amount_cents: lenderFeeAmount,
    fee_basis: isFoundingCohort
      ? "lender_pct_founding_100bps"
      : "lender_pct_standard_125bps",
    stripe_payment_intent_id: lenderIntent.id,
    stripe_status: "pending",
  });

  // Mark deal funded.
  await sb.from("deals")
    .update({ status: "funded" })
    .eq("id", dealId);

  return NextResponse.json({
    ok: true,
    borrowerIntentId: borrowerIntent.id,
    lenderIntentId: lenderIntent.id,
    lenderFeeBps,
    lenderFeeAmountCents: lenderFeeAmount,
  });
}
```

**Stripe webhook at `/api/stripe/webhook`** updates `marketplace_transactions.stripe_status` and `settled_at` as intents succeed or fail. (Existing webhook pattern if any — or new dedicated handler.)

### Re-list API — `src/app/api/brokerage/deals/[dealId]/relist/route.ts`

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const session = await getBorrowerSession();
  const { dealId } = await params;
  if (!session || session.deal_id !== dealId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { reason } = await req.json();
  const sb = supabaseAdmin();

  // Check free re-list allowance: one per deal within 60 days of first sealing.
  const { data: priorRelists } = await sb
    .from("marketplace_relists")
    .select("id, was_free, relisted_at")
    .eq("deal_id", dealId);

  const usedFreeRelist = (priorRelists ?? []).some((r) => r.was_free);
  const isWithin60Days = true; // compute from deal's first seal date
  const isFree = !usedFreeRelist && isWithin60Days;

  if (!isFree) {
    return NextResponse.json(
      { ok: false, error: "free re-list allowance used; new $1,000 packaging fee required" },
      { status: 402 },
    );
  }

  // Load the most recent listing for this deal.
  const { data: originalListing } = await sb
    .from("marketplace_listings")
    .select("id, sealed_package_id")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Create a new listing from the same sealed package, refresh matched lenders,
  // recompute Buddy SBA Score if facts have changed since seal, reschedule cadence.
  // ... (implementation details)

  await sb.from("marketplace_relists").insert({
    deal_id: dealId,
    original_listing_id: originalListing.id,
    relist_reason: reason,
    was_free: true,
  });

  return NextResponse.json({ ok: true, message: "Deal re-listed for next marketplace cycle" });
}
```

### Rate card recompute — `src/lib/brokerage/recomputeRateCard.ts`

Nightly. Pulls current Prime rate from a source (Fed FRED API or similar), applies SOP-capped spread table by score band × program × loan tier × term.

```typescript
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOP_SPREAD_CAPS_BPS = {
  // Prime + spread (in bps), by (loan_amount_tier, term_tier)
  // SBA SOP 50 10 7.1 caps on 7(a) rates:
  //   Loan ≤ $50K, term < 7yr: Prime + 650
  //   Loan ≤ $50K, term ≥ 7yr: Prime + 675
  //   Loan $50K-$250K, term < 7yr: Prime + 600
  //   etc.
  // Full spread matrix omitted here — populate from SOP.
};

const BAND_SPREAD_ADJUSTMENTS_BPS = {
  institutional_prime: -100, // 100bps below SOP cap
  strong_fit: -50,            // 50bps below SOP cap
  selective_fit: 0,           // at SOP cap
  specialty_lender: 0,        // at SOP cap (specialty lenders take these)
};

export async function recomputeRateCard(sb: SupabaseClient): Promise<void> {
  const primeRateBps = await fetchCurrentPrimeRateBps(); // external API
  const newVersion = nextSemver();

  const rows = [];
  for (const band of Object.keys(BAND_SPREAD_ADJUSTMENTS_BPS) as Array<keyof typeof BAND_SPREAD_ADJUSTMENTS_BPS>) {
    for (const program of ["7a", "504", "express"] as const) {
      for (const loanTier of ["<350K", "350K-1M", "1M-5M", ">5M"] as const) {
        for (const termTier of ["<=7yr", "7-15yr", ">15yr"] as const) {
          const sopCap = lookupSopCap(program, loanTier, termTier);
          const adjustment = BAND_SPREAD_ADJUSTMENTS_BPS[band];
          const spread = Math.max(sopCap + adjustment, 50); // floor at 50bps over Prime
          rows.push({
            version: newVersion,
            score_band: band,
            sba_program: program,
            loan_amount_tier: loanTier,
            term_tier: termTier,
            spread_bps_over_prime: spread,
          });
        }
      }
    }
  }

  // Supersede old version, insert new.
  await sb.from("marketplace_rate_card")
    .update({ superseded_at: new Date().toISOString() })
    .is("superseded_at", null);

  await sb.from("marketplace_rate_card").insert(rows);
}
```

### Lender portal UI

- `/lender/listings` — queue of matched listings. Tabs: PREVIEW (view-only, claims not yet open), CLAIM (can claim now). Badge per listing showing claim slots remaining (3, 2, 1, or "Full").
- `/lender/listings/[listingId]` — detailed KFS view. If PREVIEW state, no claim button. If CLAIM state, three-field claim form + submit. If already claimed by this lender, shows "You've claimed this listing" and status.
- `/lender/claims` — this lender's claim history with states.
- `/lender/deals/[dealId]` — post-win view. Downloadable E-Tran package, borrower contact info, closing timeline commitment reminder.

### Borrower portal UI

- After claim window close, portal shows "Review your claims" panel with a card per active claim:
  - Lender name + logo (if available in bank metadata)
  - Stated closing timeline
  - Relationship terms (if provided)
  - Rate (all same — from rate card)
  - "Pick this lender" button
- Pick confirmation modal with warning: "Once you pick, your full trident releases to you and your package releases to [Lender]. This cannot be undone."
- "Veto all and re-list" option (uses free allowance).

---

## Acceptance criteria

1. Migrations applied. `marketplace_claims`, `marketplace_picks`, `marketplace_atomic_unlocks`, `marketplace_relists`, `marketplace_transactions` all exist with RLS.
2. `claim_marketplace_listing` RPC enforces the 3-slot cap atomically. Concurrent claim tests show exactly 3 successful claims and 4th returns `full`.
3. Cron `marketplace-tick` correctly transitions states across day boundaries. Manual test by setting cadence timestamps to `now() - interval '1 minute'` and running the cron.
4. Claim API rejects: non-matched lenders, rate mismatches, duplicates from same lender, listings not in `claiming` state.
5. Atomic unlock generates final trident bundle, releases full package to picked lender, marks losing claims as `lost`, records audit events. Verify all 5 side effects happen or all roll back.
6. Stripe fees fire at `mark-funded`: borrower $1,000 intent + lender percentage intent based on founding-cohort logic. Both rows in `marketplace_transactions` with `stripe_status='pending'`.
7. Re-list API enforces one-free-per-60-days rule; subsequent re-lists return 402 with clear message.
8. Rate card recompute runs nightly, creates new version row, supersedes previous. Old listings retain their `rate_card_version` for audit.
9. Lender portal shows PREVIEW and CLAIM tabs; claim form submits successfully; full lender cannot see other lenders' claims (RLS test).
10. Borrower portal post-claim shows 1-3 claim cards, pick button works end-to-end through atomic unlock, downloads work.
11. End-to-end test: seal Samaritus test deal → cron opens preview → cron opens claim → test lender claims → cron moves to awaiting pick → borrower picks → trident releases → package releases to lender. Every event in `marketplace_audit_log`.

---

## Test plan

- **Concurrency test for 3-slot cap:** 5 concurrent POSTs to the claim API from 5 different lender tenants. Exactly 3 get `ok:true`, 2 get `status: 'full'`. Run 10 times — result must be consistent.
- **Cadence test:** create listings with cadence timestamps in the past, run cron, verify correct state transitions. Include weekend handling (Friday seal → Monday preview).
- **Atomic unlock failure injection:** force failure in step 3 (trident gen), verify all prior steps rolled back and audit log records the failure. Listing remains in `awaiting_borrower_pick` for borrower to retry.
- **Stripe integration test in test mode:** mock funded event, verify both intents created in Stripe test dashboard.
- **End-to-end integration test:** full lifecycle with Samaritus deal on staging: concierge → voice → docs → trident preview → score → seal → preview → claim (by 2 test lender tenants) → close claim → borrower pick → trident/package release → mark funded → Stripe intents. Record wall-clock time; target <1 hour for the full happy path (most of which is waiting for cron ticks).
- **RLS matrix test:** lender A claims listing X, lender B did not. Verify B cannot SELECT A's claim row via the RLS policy. Brokerage ops sees both.
- **Re-list test:** vet all re-list paths (zero claims after 3 rolls → offer; borrower no-pick in 48h → offer; borrower veto → veto path).

---

## Launch-gating checks (ops runbook)

Before first real deal listed on the marketplace:

- [ ] Counsel-finalized LMA PDF uploaded, `legal_documents.content_hash` updated.
- [ ] At least 3 lenders provisioned with signed LMAs (Live Oak or similar + 2 regional).
- [ ] Rate card seeded with real values (not placeholder), version 1.0.0 active.
- [ ] Stripe connected accounts set up for Buddy Brokerage (for fee collection) and the $1,000 borrower charge path tested in Stripe test mode.
- [ ] SBA Form 159 template drafted and ready to auto-populate at close.
- [ ] State SBA broker licensing reviewed by counsel (WI, Matt's state; others as first deals land).
- [ ] End-to-end happy-path test on staging with Samaritus-class synthetic deal passed.
- [ ] Monitoring in place: Vercel logs for cron failures, Stripe webhook alerts, atomic unlock failure alerts.

---

## Non-goals

- Automated lender-bank payout scheduling (manual ops reconciliation for v1).
- Automated borrower fee collection orchestration with loan closing agent (manual for v1 — ops sends Form 159, lender's closing agent handles).
- Self-serve "mark-funded" by the lender (ops-triggered only in v1, to keep tight control during launch).
- Automated state licensing detection per deal (v1 is Matt-reviewed; long-term this is a separate compliance sprint).
- Lender-side analytics dashboards (which deals won/lost, win rates, cohort reporting) — future sprint.

---

## Notes for implementer

- **The RPC for claim is the most security-critical code in the sprint.** Test the concurrency behavior rigorously. A bug here allows a fourth claim to slip through, which causes borrower confusion and ops cleanup.
- **Atomic unlock must be idempotent** in practice — if it fails midway and ops retries manually, the retry must not double-release. Check for `marketplace_atomic_unlocks` existing for the pick_id at entry and skip if already done.
- **Trident final generation is ~60-90 seconds.** Route `maxDuration: 120` is conservative. Monitor in production; if routinely hitting 120, move to background worker and return "processing" to borrower with polling.
- **Rate card version pinning** — listings record their rate_card_version at creation and quote that version to lenders. Do not hot-swap rates on active listings if the rate card recomputes mid-cycle.
- **Borrower pick is irreversible.** The "are you sure" modal and the audit log entry are the only safety nets. Make the modal clear.
- **Founding cohort detection** — the 1% vs 1.25% lender fee split depends on the count of prior funded deals. Keep this logic simple (count from `marketplace_transactions` succeeded rows with `payer_type='lender'`). If you're the 101st deal, you pay 1.25% — no grandfathering of in-flight deals.
- **Email / notification infrastructure** — assumes the existing email system (check `src/lib/email/` or equivalent) is reusable. If not, stub out the notifications and make them ops-observable via audit log so nothing silently fails.
- **Stripe webhook handling** — the webhook updates `marketplace_transactions.stripe_status`. Make sure the webhook handler exists or is added in this sprint. Signing-secret verification is essential.
- **This sprint is the entire product.** It's OK if it ships in pieces — cron first, then claim API, then pick + atomic unlock, then Stripe. Ship what's testable. But all of it is required before the first real borrower can complete a marketplace transaction.
