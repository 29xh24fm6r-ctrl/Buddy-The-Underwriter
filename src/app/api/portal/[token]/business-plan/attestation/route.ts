import "server-only";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — borrower-facing business-plan attestation.
 *
 * GET  /api/portal/[token]/business-plan/attestation
 *   Returns the latest generated SBA package's narrative sections, the
 *   section-level provenance (which BorrowerStory fields fed each section
 *   — businessPlanProvenance.ts), and the current attestation status
 *   (businessPlanAttestation.ts).
 *
 * POST /api/portal/[token]/business-plan/attestation
 *   Records a new attestation row for the CURRENT narrative snapshot.
 *   Immutable/append-only — never edits a prior attestation.
 *
 * Auth: resolveBorrowerToken(token) only — same convention as every other
 * src/app/api/portal/[token]/** route (glass-box, fix-cards, SPEC-M7
 * sba-forms). No Clerk, no assertDealAccess.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";
import { loadBorrowerStory } from "@/lib/sba/sbaBorrowerStory";
import { buildBusinessPlanProvenance } from "@/lib/sba/businessPlanProvenance";
import {
  hashPackageNarratives,
  getBusinessPlanAttestationStatus,
  recordBusinessPlanAttestation,
} from "@/lib/sba/businessPlanAttestation";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ token: string }> };

const NARRATIVE_COLUMNS =
  "id, business_overview_narrative, executive_summary, industry_analysis, marketing_strategy, " +
  "operations_plan, swot_strengths, swot_weaknesses, swot_opportunities, swot_threats, " +
  "sensitivity_narrative, plan_thesis";

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { token } = await ctx.params;

  let dealId: string;
  try {
    const resolved = await resolveBorrowerToken(token);
    dealId = resolved.deal_id;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid or expired portal link" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  const [{ data: pkg }, story] = await Promise.all([
    sb
      .from("buddy_sba_packages")
      .select(NARRATIVE_COLUMNS)
      .eq("deal_id", dealId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadBorrowerStory(dealId),
  ]);

  if (!pkg) {
    return NextResponse.json({ ok: true, package: null, provenance: null, attestation: null });
  }

  const snapshotHash = hashPackageNarratives(pkg as unknown as Record<string, unknown>);
  const [provenance, attestation] = await Promise.all([
    Promise.resolve(buildBusinessPlanProvenance(story)),
    getBusinessPlanAttestationStatus(dealId, snapshotHash, sb),
  ]);

  return NextResponse.json({ ok: true, package: pkg, provenance, attestation });
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { token } = await ctx.params;

  let dealId: string;
  let bankId: string;
  let attestedByName: string | null;
  let attestedByEmail: string | null;
  try {
    const resolved = await resolveBorrowerToken(token);
    dealId = resolved.deal_id;
    bankId = resolved.bank_id;
    attestedByName = resolved.name;
    attestedByEmail = resolved.email;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid or expired portal link" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || body.confirm !== true) {
    return NextResponse.json({ ok: false, error: "missing_confirmation" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  const { data: pkg } = await sb
    .from("buddy_sba_packages")
    .select(NARRATIVE_COLUMNS)
    .eq("deal_id", dealId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pkg) {
    return NextResponse.json({ ok: false, error: "no_package" }, { status: 404 });
  }

  const snapshotHash = hashPackageNarratives(pkg as unknown as Record<string, unknown>);

  try {
    await recordBusinessPlanAttestation({
      dealId,
      bankId,
      packageId: (pkg as unknown as { id: string }).id,
      narrativeSnapshotHash: snapshotHash,
      attestedByName,
      attestedByEmail,
      sb,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[portal/business-plan/attestation] failed:", msg);
    return NextResponse.json({ ok: false, error: "attestation_failed" }, { status: 500 });
  }

  const attestation = await getBusinessPlanAttestationStatus(dealId, snapshotHash, sb);
  return NextResponse.json({ ok: true, attestation });
}
