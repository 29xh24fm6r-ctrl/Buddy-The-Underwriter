import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

export async function GET(
  _req: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  const [
    applicationResult,
    sectionsResult,
    docsResult,
    identityResult,
    signingResult,
    signedResult,
    scoreResult,
    bundleResult,
    assumptionsResult,
  ] = await Promise.all([
    sb
      .from("borrower_applications")
      .select("id, status, submitted_at, created_at")
      .eq("deal_id", ctx.dealId)
      .maybeSingle(),
    sb
      .from("deal_builder_sections")
      .select("section_key, completed")
      .eq("deal_id", ctx.dealId),
    sb
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", ctx.dealId),
    sb
      .from("borrower_identity_verifications")
      .select("id, ownership_entity_id, status, completed_at")
      .eq("deal_id", ctx.dealId),
    sb
      .from("signing_requests")
      .select("id, form_code, signer_ownership_entity_id, status")
      .eq("deal_id", ctx.dealId),
    sb
      .from("signed_documents")
      .select("id, form_code, signer_ownership_entity_id, signature_completed_at")
      .eq("deal_id", ctx.dealId),
    sb
      .from("buddy_sba_scores")
      .select("score, band, eligibility_passed, computed_at, score_status")
      .eq("deal_id", ctx.dealId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("buddy_trident_bundles")
      .select("id, status, created_at")
      .eq("deal_id", ctx.dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("buddy_sba_assumptions")
      .select("status, confirmed_at")
      .eq("deal_id", ctx.dealId)
      .maybeSingle(),
  ]);

  const app = applicationResult.data;
  const sections = sectionsResult.data ?? [];
  const completedSections = sections.filter((s: { completed: boolean }) => s.completed).map((s: { section_key: string }) => s.section_key);

  const identities = identityResult.data ?? [];
  const verified = identities.filter((v: { status: string }) => ["approved", "completed"].includes(v.status));
  const pendingKyc = identities.filter((v: { status: string }) => ["created", "pending"].includes(v.status));

  const signedDocs = signedResult.data ?? [];
  const pendingSigning = (signingResult.data ?? []).filter((s: { status: string }) => s.status !== "Completed");

  const milestones = [
    {
      key: "application_submitted",
      label: "Application Submitted",
      complete: app?.status === "submitted",
      detail: app?.submitted_at ? `Submitted ${new Date(app.submitted_at as string).toLocaleDateString()}` : null,
    },
    {
      key: "documents_uploaded",
      label: "Documents Uploaded",
      complete: (docsResult.count ?? 0) > 0,
      detail: `${docsResult.count ?? 0} document${(docsResult.count ?? 0) !== 1 ? "s" : ""} uploaded`,
    },
    {
      key: "assumptions_confirmed",
      label: "Financial Projections Confirmed",
      complete: assumptionsResult.data?.status === "confirmed",
      detail: assumptionsResult.data?.confirmed_at
        ? `Confirmed ${new Date(assumptionsResult.data.confirmed_at as string).toLocaleDateString()}`
        : null,
    },
    {
      key: "identity_verified",
      label: "Identity Verification",
      complete: verified.length > 0 && pendingKyc.length === 0,
      detail: `${verified.length} verified, ${pendingKyc.length} pending`,
    },
    {
      key: "forms_signed",
      label: "SBA Forms Signed",
      complete: signedDocs.length > 0 && pendingSigning.length === 0,
      detail: `${signedDocs.length} signed, ${pendingSigning.length} pending`,
    },
    {
      key: "package_generated",
      label: "Loan Package Generated",
      complete: bundleResult.data?.status === "completed",
      detail: bundleResult.data ? `Status: ${bundleResult.data.status}` : null,
    },
    {
      key: "score_computed",
      label: "Approval Score",
      complete: scoreResult.data != null,
      detail: scoreResult.data
        ? `Score: ${scoreResult.data.score} (${scoreResult.data.band})`
        : null,
    },
  ];

  const nextActions: Array<{ key: string; label: string; actionUrl?: string }> = [];

  if (pendingKyc.length > 0) {
    nextActions.push({
      key: "complete_kyc",
      label: `Complete identity verification (${pendingKyc.length} pending)`,
    });
  }

  if (pendingSigning.length > 0) {
    nextActions.push({
      key: "sign_forms",
      label: `Sign pending SBA forms (${pendingSigning.length} remaining)`,
    });
  }

  if ((docsResult.count ?? 0) === 0) {
    nextActions.push({
      key: "upload_docs",
      label: "Upload supporting documents",
    });
  }

  return NextResponse.json({
    ok: true,
    applicationStatus: app?.status ?? "draft",
    completedSections,
    milestones,
    nextActions,
  });
}
