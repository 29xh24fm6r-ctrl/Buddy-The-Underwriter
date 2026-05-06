// SPEC-INTAKE-V2 fix — consolidated memo-inputs dispatcher.
//
// Replaces 6 sub-routes (borrower-story, collateral, conflicts, from-wizard,
// management, prefill) with verb + discriminator dispatch on a single endpoint
// to free Vercel route-manifest entries (resolves the too_many_routes deploy
// failure introduced when the memo-input completeness layer pushed the
// manifest from 2048 to 2065).
//
// Contract:
//
//   GET    /memo-inputs                    → full memo-input package (default)
//          /memo-inputs?section=conflicts  → list all fact conflicts
//          /memo-inputs?section=prefill    → suggested prefill values
//
//   PUT    /memo-inputs                    → upsert borrower story
//          body: subset of PATCHABLE_BORROWER_STORY_KEYS
//
//   POST   /memo-inputs                    body: { kind, ...payload }
//          kind = "collateral"             → create collateral item
//          kind = "management"             → create management profile
//          kind = "conflicts"              → resolve / acknowledge / ignore a conflict
//          kind = "from-wizard"            → wizard write (overrides → canonical tables)
//
//   PATCH  /memo-inputs                    body: { kind, id, ...payload }
//          kind = "collateral"             → update collateral item by id
//          kind = "management"             → update management profile by id
//
//   DELETE /memo-inputs?kind=management&id=<uuid>
//                                          → delete management profile by id
//
// Handler bodies preserved verbatim from the prior per-section files —
// the only behavior delta is wire shape (URL path → discriminator).

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildMemoInputPackage } from "@/lib/creditMemo/inputs/buildMemoInputPackage";
import { upsertBorrowerStory } from "@/lib/creditMemo/inputs/upsertBorrowerStory";
import { upsertCollateralItem } from "@/lib/creditMemo/inputs/upsertCollateralItem";
import {
  upsertManagementProfile,
  deleteManagementProfile,
} from "@/lib/creditMemo/inputs/upsertManagementProfile";
import { resolveFactConflict } from "@/lib/creditMemo/inputs/resolveFactConflict";
import { loadAllFactConflicts } from "@/lib/creditMemo/inputs/reconcileDealFacts";
import { prefillMemoInputs } from "@/lib/creditMemo/inputs/prefillMemoInputs";

export const runtime = "nodejs";
export const maxDuration = 30;

// ── Constants (verbatim from per-section routes) ────────────────────────

const PATCHABLE_BORROWER_STORY_KEYS = [
  "business_description",
  "revenue_model",
  "products_services",
  "customers",
  "customer_concentration",
  "competitive_position",
  "growth_strategy",
  "seasonality",
  "key_risks",
  "banker_notes",
] as const;

const COLLATERAL_STRING_KEYS = [
  "collateral_type",
  "description",
  "owner_name",
  "lien_position",
  "valuation_source",
  "source_document_id",
] as const;
const COLLATERAL_NUMBER_KEYS = [
  "market_value",
  "appraised_value",
  "discounted_value",
  "advance_rate",
  "confidence",
] as const;

const MANAGEMENT_STRING_KEYS = [
  "person_name",
  "title",
  "industry_experience",
  "prior_business_experience",
  "resume_summary",
  "credit_relevance",
] as const;
const MANAGEMENT_NUMBER_KEYS = ["ownership_pct", "years_experience"] as const;

const ALLOWED_CONFLICT_STATUSES = [
  "acknowledged",
  "resolved",
  "ignored",
] as const;

const PRINCIPAL_BIO_PREFIX = "principal_bio_";

// ── Patch builders (verbatim from per-section routes) ───────────────────

function buildCollateralPatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const k of COLLATERAL_STRING_KEYS) {
    if (typeof body[k] === "string") patch[k] = body[k];
  }
  for (const k of COLLATERAL_NUMBER_KEYS) {
    const v = body[k];
    if (typeof v === "number" && Number.isFinite(v)) patch[k] = v;
    else if (typeof v === "string" && v.trim().length > 0) {
      const n = Number(v.replace(/[$,\s]/g, ""));
      if (Number.isFinite(n)) patch[k] = n;
    } else if (v === null) patch[k] = null;
  }
  if (typeof body.valuation_date === "string") {
    patch.valuation_date = body.valuation_date;
  }
  return patch;
}

function buildManagementPatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const k of MANAGEMENT_STRING_KEYS) {
    if (typeof body[k] === "string") patch[k] = body[k];
  }
  for (const k of MANAGEMENT_NUMBER_KEYS) {
    const v = body[k];
    if (typeof v === "number" && Number.isFinite(v)) patch[k] = v;
    else if (typeof v === "string" && v.trim().length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) patch[k] = n;
    } else if (v === null) patch[k] = null;
  }
  return patch;
}

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// ── Section handlers (verbatim logic from per-section routes) ───────────

async function getPackage(dealId: string) {
  const result = await buildMemoInputPackage({
    dealId,
    runReconciliation: true,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason, error: result.error ?? null },
      { status: result.reason === "tenant_mismatch" ? 403 : 500 },
    );
  }
  return NextResponse.json({ ok: true, package: result.package });
}

async function getConflicts(dealId: string, bankId: string) {
  const conflicts = await loadAllFactConflicts({ dealId, bankId });
  return NextResponse.json({ ok: true, conflicts });
}

async function getPrefill(dealId: string) {
  const result = await prefillMemoInputs({ dealId });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason, error: result.error ?? null },
      { status: result.reason === "tenant_mismatch" ? 403 : 500 },
    );
  }
  return NextResponse.json({ ok: true, prefill: result.prefill });
}

async function putBorrowerStory(
  dealId: string,
  body: Record<string, unknown>,
) {
  const patch: Record<string, string> = {};
  for (const k of PATCHABLE_BORROWER_STORY_KEYS) {
    const v = body[k];
    if (typeof v === "string") patch[k] = v;
  }
  const result = await upsertBorrowerStory({
    dealId,
    patch: patch as Parameters<typeof upsertBorrowerStory>[0]["patch"],
    source: "banker",
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason, error: result.error ?? null },
      { status: result.reason === "tenant_mismatch" ? 403 : 500 },
    );
  }
  return NextResponse.json({ ok: true, story: result.story });
}

async function postCreateCollateral(
  dealId: string,
  body: Record<string, unknown>,
) {
  const patch = buildCollateralPatch(body);
  const result = await upsertCollateralItem({
    dealId,
    patch: patch as Parameters<typeof upsertCollateralItem>[0]["patch"],
  });
  if (!result.ok) {
    const status =
      result.reason === "tenant_mismatch"
        ? 403
        : result.reason === "missing_required_fields"
          ? 400
          : 500;
    return NextResponse.json(
      { ok: false, reason: result.reason, error: result.error ?? null },
      { status },
    );
  }
  return NextResponse.json({ ok: true, item: result.item });
}

async function patchUpdateCollateral(
  dealId: string,
  body: Record<string, unknown>,
) {
  const itemId = typeof body.id === "string" ? body.id : "";
  if (!itemId) {
    return NextResponse.json(
      { ok: false, error: "missing id" },
      { status: 400 },
    );
  }
  const patch = buildCollateralPatch(body);
  const requiresReviewOverride =
    typeof body.requires_review === "boolean"
      ? (body.requires_review as boolean)
      : undefined;
  const result = await upsertCollateralItem({
    dealId,
    itemId,
    patch: patch as Parameters<typeof upsertCollateralItem>[0]["patch"],
    requiresReviewOverride,
  });
  if (!result.ok) {
    const status =
      result.reason === "tenant_mismatch"
        ? 403
        : result.reason === "not_found"
          ? 404
          : 500;
    return NextResponse.json(
      { ok: false, reason: result.reason, error: result.error ?? null },
      { status },
    );
  }
  return NextResponse.json({ ok: true, item: result.item });
}

async function postCreateManagement(
  dealId: string,
  body: Record<string, unknown>,
) {
  const patch = buildManagementPatch(body);
  const result = await upsertManagementProfile({
    dealId,
    patch: patch as Parameters<typeof upsertManagementProfile>[0]["patch"],
    source: "banker",
  });
  if (!result.ok) {
    const status =
      result.reason === "tenant_mismatch"
        ? 403
        : result.reason === "missing_person_name"
          ? 400
          : 500;
    return NextResponse.json(
      { ok: false, reason: result.reason, error: result.error ?? null },
      { status },
    );
  }
  return NextResponse.json({ ok: true, profile: result.profile });
}

async function patchUpdateManagement(
  dealId: string,
  body: Record<string, unknown>,
) {
  const profileId = typeof body.id === "string" ? body.id : "";
  if (!profileId) {
    return NextResponse.json(
      { ok: false, error: "missing id" },
      { status: 400 },
    );
  }
  const patch = buildManagementPatch(body);
  const result = await upsertManagementProfile({
    dealId,
    profileId,
    patch: patch as Parameters<typeof upsertManagementProfile>[0]["patch"],
    source: "banker",
  });
  if (!result.ok) {
    const status =
      result.reason === "tenant_mismatch"
        ? 403
        : result.reason === "not_found"
          ? 404
          : 500;
    return NextResponse.json(
      { ok: false, reason: result.reason, error: result.error ?? null },
      { status },
    );
  }
  return NextResponse.json({ ok: true, profile: result.profile });
}

async function deleteManagementBy(dealId: string, profileId: string) {
  const result = await deleteManagementProfile({ dealId, profileId });
  if (!result.ok) {
    const status = result.reason === "tenant_mismatch" ? 403 : 404;
    return NextResponse.json(
      { ok: false, reason: result.reason, error: result.error ?? null },
      { status },
    );
  }
  return NextResponse.json({ ok: true });
}

async function postResolveConflict(
  dealId: string,
  bankerId: string,
  body: Record<string, unknown>,
) {
  const conflictId = typeof body.id === "string" ? body.id : "";
  const newStatus = typeof body.status === "string" ? body.status : "";
  if (!conflictId) {
    return NextResponse.json(
      { ok: false, error: "missing id" },
      { status: 400 },
    );
  }
  if (!(ALLOWED_CONFLICT_STATUSES as readonly string[]).includes(newStatus)) {
    return NextResponse.json(
      { ok: false, error: "invalid status" },
      { status: 400 },
    );
  }
  const result = await resolveFactConflict({
    dealId,
    conflictId,
    bankerId,
    newStatus: newStatus as (typeof ALLOWED_CONFLICT_STATUSES)[number],
    resolution:
      typeof body.resolution === "string" ? body.resolution : undefined,
    resolvedValue: body.resolved_value ?? undefined,
  });
  if (!result.ok) {
    const status =
      result.reason === "tenant_mismatch"
        ? 403
        : result.reason === "not_found"
          ? 404
          : 500;
    return NextResponse.json(
      { ok: false, reason: result.reason, error: result.error ?? null },
      { status },
    );
  }
  return NextResponse.json({ ok: true, conflict: result.conflict });
}

async function postFromWizard(
  dealId: string,
  bankId: string,
  body: { overrides?: Record<string, unknown> },
) {
  const overrides = body?.overrides ?? {};

  // ── Borrower-story patch ─────────────────────────────────────────
  const businessDescription = asTrimmedString(overrides.business_description);
  const revenueModel = asTrimmedString(overrides.revenue_mix);
  const seasonality = asTrimmedString(overrides.seasonality);
  const competitiveAdvantages = asTrimmedString(
    overrides.competitive_advantages,
  );
  const bankerSummary = asTrimmedString(overrides.banker_summary);

  const storyPatch: Record<string, string | null> = {};
  if (businessDescription !== null)
    storyPatch.business_description = businessDescription;
  if (revenueModel !== null) storyPatch.revenue_model = revenueModel;
  if (seasonality !== null) storyPatch.seasonality = seasonality;
  if (competitiveAdvantages !== null)
    storyPatch.key_risks = competitiveAdvantages;
  if (bankerSummary !== null) storyPatch.banker_notes = bankerSummary;

  let borrowerStoryWritten = false;
  if (Object.keys(storyPatch).length > 0) {
    const out = await upsertBorrowerStory({
      dealId,
      patch: storyPatch,
      source: "banker",
      confidence: 1,
    });
    borrowerStoryWritten = out.ok;
  }

  // ── Management-profile patches ───────────────────────────────────
  const sb = supabaseAdmin();
  const { data: ownersRaw } = await (sb as any)
    .from("ownership_entities")
    .select("id, display_name")
    .eq("deal_id", dealId);
  const owners = (
    (ownersRaw ?? []) as Array<{ id: string; display_name: string | null }>
  ).reduce<Record<string, string>>((acc, row) => {
    acc[row.id] = (row.display_name ?? "").trim() || "Unknown";
    return acc;
  }, {});

  let managementWrites = 0;
  for (const [key, raw] of Object.entries(overrides)) {
    if (!key.startsWith(PRINCIPAL_BIO_PREFIX)) continue;
    const ownerId = key.slice(PRINCIPAL_BIO_PREFIX.length);
    const summary = asTrimmedString(raw);
    if (summary === null) continue;
    const personName = owners[ownerId] ?? "Unknown";
    const out = await upsertManagementProfile({
      dealId,
      patch: { person_name: personName, resume_summary: summary },
      source: "banker",
      confidence: 1,
    });
    if (out.ok) managementWrites += 1;
  }

  return NextResponse.json({
    ok: true,
    borrowerStoryWritten,
    managementWrites,
    bankId,
  });
}

// ── Verb dispatchers ─────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const auth = await requireDealAccess(dealId);
    const url = new URL(req.url);
    const section = url.searchParams.get("section");

    if (!section) return await getPackage(dealId);
    if (section === "conflicts")
      return await getConflicts(dealId, auth.bankId);
    if (section === "prefill") return await getPrefill(dealId);

    return NextResponse.json(
      { ok: false, error: `unknown section: ${section}` },
      { status: 400 },
    );
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs GET]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    await requireDealAccess(dealId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return await putBorrowerStory(dealId, body);
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs PUT]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = typeof body.kind === "string" ? body.kind : "";

    // from-wizard preserved its original ensureDealBankAccess flow (returns
    // 403 JSON on failure, not a redirect — the legacy contract callers rely on).
    if (kind === "from-wizard") {
      const access = await ensureDealBankAccess(dealId);
      if (!access.ok) {
        return NextResponse.json(
          { ok: false, error: access.error },
          { status: 403 },
        );
      }
      return await postFromWizard(
        dealId,
        access.bankId,
        body as { overrides?: Record<string, unknown> },
      );
    }

    const auth = await requireDealAccess(dealId);
    if (kind === "collateral") return await postCreateCollateral(dealId, body);
    if (kind === "management") return await postCreateManagement(dealId, body);
    if (kind === "conflicts")
      return await postResolveConflict(dealId, auth.userId, body);

    return NextResponse.json(
      { ok: false, error: `unknown kind: ${kind || "(missing)"}` },
      { status: 400 },
    );
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs POST]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    await requireDealAccess(dealId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = typeof body.kind === "string" ? body.kind : "";

    if (kind === "collateral") return await patchUpdateCollateral(dealId, body);
    if (kind === "management") return await patchUpdateManagement(dealId, body);

    return NextResponse.json(
      { ok: false, error: `unknown kind: ${kind || "(missing)"}` },
      { status: 400 },
    );
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs PATCH]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    await requireDealAccess(dealId);
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") ?? "";
    const id = url.searchParams.get("id") ?? "";

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "missing id" },
        { status: 400 },
      );
    }
    if (kind === "management") return await deleteManagementBy(dealId, id);

    return NextResponse.json(
      { ok: false, error: `unknown kind: ${kind || "(missing)"}` },
      { status: 400 },
    );
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs DELETE]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
