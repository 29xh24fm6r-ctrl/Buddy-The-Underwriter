/**
 * BRK-10G Package Delivery — controlled delivery for borrowers and lenders.
 */
import { getLatestAssembledPackageRun } from "@/lib/sba/package/getLatestAssembledPackageRun";

export type PackageResource = { type: string; label: string; available: boolean; downloadKey: string | null };
export type PackageManifest = { dealId: string; sealedAt: string | null; accessLevel: "full" | "preview" | "none"; resources: PackageResource[] };
export type BorrowerPackageStatus = { sealed: boolean; sealedAt: string | null; dealId: string; packageId: string | null; pickedLenderName: string | null; complianceReady: boolean; manifest: PackageManifest };
export type LenderPackageAccess = { accessId: string; dealId: string; listingId: string; claimId: string; lenderBankId: string; accessLevel: string; grantedAt: string | null; dealSummary: { loanAmount: number | null; program: string | null; termMonths: number | null; score: number | null; band: string | null; state: string | null }; manifest: PackageManifest };
export type PackageAuditEntry = { actor: string; actorScope: "borrower" | "lender" | "system"; dealId: string; action: "package_view" | "package_download"; resourceType?: string; metadata?: Record<string, any> };
type SB = { from: (t: string) => any };
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function res(type: string, label: string, path: string | null): PackageResource { return { type, label, available: path != null && path.length > 0, downloadKey: path ? type : null }; }

async function latestSucceededBundle(dealId: string, sb: SB): Promise<Record<string, unknown> | null> {
  // Prefer the frozen-at-pick final bundle; fall back to the live preview
  // bundle for deals that haven't been picked yet. Two queries (not one
  // mode-less query + .maybeSingle()) because a deal can legitimately have
  // BOTH a current succeeded preview bundle AND a current succeeded final
  // bundle at once (supersession is scoped per (deal, mode), not per deal) —
  // a single unscoped query would either throw on >1 row or return an
  // arbitrary one. Mirrors the selection logic in
  // src/app/api/brokerage/deals/[dealId]/trident/download/[kind]/route.ts.
  const { data: finalBundle } = await sb
    .from("buddy_trident_bundles")
    .select("business_plan_pdf_path, projections_pdf_path, projections_xlsx_path, feasibility_pdf_path")
    .eq("deal_id", dealId)
    .eq("mode", "final")
    .eq("status", "succeeded")
    .is("superseded_at", null)
    .maybeSingle();
  if (finalBundle) return finalBundle;
  const { data: previewBundle } = await sb
    .from("buddy_trident_bundles")
    .select("business_plan_pdf_path, projections_pdf_path, projections_xlsx_path, feasibility_pdf_path")
    .eq("deal_id", dealId)
    .eq("mode", "preview")
    .eq("status", "succeeded")
    .is("superseded_at", null)
    .maybeSingle();
  return previewBundle ?? null;
}

export async function buildPackageManifest(dealId: string, accessLevel: "full"|"preview"|"none", sb: SB): Promise<PackageManifest> {
  if (accessLevel === "none") return { dealId, sealedAt: null, accessLevel, resources: [] };
  const { data: sp } = await sb.from("buddy_sealed_packages").select("id, sealed_at, final_business_plan_path, final_projections_path, final_feasibility_path, final_credit_memo_path, final_forms_path, final_source_docs_zip_path").eq("deal_id", dealId).is("unsealed_at", null).limit(1).maybeSingle();
  if (!sp) return { dealId, sealedAt: null, accessLevel, resources: [] };
  const b = await latestSucceededBundle(dealId, sb);
  const { data: f } = await sb.from("sba_form_159_records").select("generated_pdf_path, status").eq("deal_id", dealId).in("status", ["generated","borrower_acknowledged","fully_acknowledged","locked"]).limit(1).maybeSingle();
  // credit_memo has no stored path (rendered on demand — see the trident
  // download dispatcher's credit_memo branch) — report available whenever a
  // certified snapshot exists for this deal, so the UI doesn't offer a
  // doomed download button.
  const { data: memoSnapshot } = await sb.from("credit_memo_snapshots").select("id").eq("deal_id", dealId).in("status", ["banker_submitted", "underwriter_review", "returned", "finalized"]).limit(1).maybeSingle();
  // sba_forms: buddy_sealed_packages.final_forms_path is never populated
  // (same gap as the other final_* columns pre-pick-time-generation — see
  // the marketplace/pick route). Falls back to the most recently assembled
  // sba_package_runs row for this deal, if the 10-tab assembly pipeline
  // (assembleTenTabPackage.ts, triggered manually via the sba/route.ts
  // action dispatch — there is no automatic trigger yet) has ever actually
  // run for it.
  const assembledRun = sp.final_forms_path ? null : await getLatestAssembledPackageRun(dealId, sb);
  const r: PackageResource[] = [
    res("business_plan", "Business Plan", str(sp.final_business_plan_path) ?? str(b?.business_plan_pdf_path as string | null | undefined)),
    // Final mode produces only the XLSX workbook (no redacted summary PDF —
    // that's preview-only), so once a deal is picked this resource is
    // legitimately unavailable; the live preview bundle (if still present)
    // is the only possible source before that.
    res("projections_pdf", "Projections (PDF)", str(b?.projections_pdf_path as string | null | undefined)),
    res("projections_xlsx", "Projections (XLSX)", str(sp.final_projections_path) ?? str(b?.projections_xlsx_path as string | null | undefined)),
    res("feasibility", "Feasibility Study", str(sp.final_feasibility_path) ?? str(b?.feasibility_pdf_path as string | null | undefined)),
    { type: "credit_memo", label: "Credit Memo", available: Boolean(memoSnapshot), downloadKey: memoSnapshot ? "credit_memo" : null },
    res("sba_forms", "SBA Forms", str(sp.final_forms_path) ?? assembledRun?.storagePath ?? null),
    res("form_159", "Form 159", str(f?.generated_pdf_path)),
  ];
  if (accessLevel === "full") r.push(res("source_docs","Source Documents (ZIP)",str(sp.final_source_docs_zip_path)));
  return { dealId, sealedAt: str(sp.sealed_at), accessLevel, resources: r };
}

export async function getBorrowerPackageStatus(session: { deal_id: string }, sb: SB): Promise<BorrowerPackageStatus> {
  const dealId = session.deal_id;
  const { data: sp } = await sb.from("buddy_sealed_packages").select("id, sealed_at").eq("deal_id", dealId).is("unsealed_at", null).limit(1).maybeSingle();
  const { data: pick } = await sb.from("marketplace_picks").select("picked_lender_bank_id").eq("deal_id", dealId).eq("status", "picked").limit(1).maybeSingle();
  let pln: string | null = null;
  if (pick?.picked_lender_bank_id) { const { data: bank } = await sb.from("banks").select("name").eq("id", pick.picked_lender_bank_id).maybeSingle(); pln = str(bank?.name); }
  const sealed = Boolean(sp); const manifest = await buildPackageManifest(dealId, sealed ? "full" : "none", sb);
  const { data: f159 } = await sb.from("sba_form_159_records").select("status").eq("deal_id", dealId).in("status", ["generated","borrower_acknowledged","fully_acknowledged","locked"]).limit(1).maybeSingle();
  return { sealed, sealedAt: str(sp?.sealed_at), dealId, packageId: sp ? String(sp.id) : null, pickedLenderName: pln, complianceReady: Boolean(f159), manifest };
}

export async function getLenderPackageAccess(accessId: string, lenderBankId: string, sb: SB): Promise<{ ok: true; access: LenderPackageAccess } | { ok: false; error: string }> {
  const { data: a } = await sb.from("marketplace_package_access").select("id, listing_id, claim_id, deal_id, lender_bank_id, access_level, granted_at, revoked_at").eq("id", accessId).maybeSingle();
  if (!a) return { ok: false, error: "access_not_found" }; if (String(a.lender_bank_id) !== lenderBankId) return { ok: false, error: "access_lender_mismatch" }; if (a.revoked_at) return { ok: false, error: "access_revoked" };
  const dealId = String(a.deal_id); const level = str(a.access_level) === "full" ? "full" as const : "preview" as const;
  const { data: l } = await sb.from("marketplace_listings").select("loan_amount, sba_program, term_months, score, band, kfs").eq("deal_id", dealId).limit(1).maybeSingle();
  const manifest = await buildPackageManifest(dealId, level, sb);
  return { ok: true, access: { accessId: String(a.id), dealId, listingId: String(a.listing_id), claimId: String(a.claim_id), lenderBankId: String(a.lender_bank_id), accessLevel: str(a.access_level) ?? "full", grantedAt: str(a.granted_at), dealSummary: { loanAmount: num(l?.loan_amount), program: str(l?.sba_program), termMonths: num(l?.term_months), score: num(l?.score), band: str(l?.band), state: str(l?.kfs?.state) }, manifest } };
}

// This function itself still has no direct caller (the real UI — see
// SealPackageCard.tsx and LenderPackageClient.tsx — calls the trident
// download dispatcher route directly, matching the pattern this function
// returns). Kept correct for whatever future caller needs a URL string
// rather than a redirect. Previously this returned a `deal`+`exp`
// query-string URL with no signature at all, pointing at
// /api/brokerage/package/signed/[resourceType], a route that never existed.
// All six resource types now route to the trident download dispatcher
// (src/app/api/brokerage/deals/[dealId]/trident/download/[kind]/route.ts),
// which handles each kind's real signing/rendering logic — including
// sba_forms, whose merged-PDF path is now resolved via
// getLatestAssembledPackageRun rather than a never-populated column.
export async function createSignedPackageDownload(dealId: string, resourceType: string, _actor: { id: string; scope: string }, _sb: SB): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  return { ok: true, url: `/api/brokerage/deals/${encodeURIComponent(dealId)}/trident/download/${encodeURIComponent(resourceType)}` };
}

export async function auditPackageView(entry: PackageAuditEntry, sb: SB): Promise<void> { await sb.from("marketplace_audit_log").insert({ deal_id: entry.dealId, actor_bank_id: entry.actor, actor_scope: entry.actorScope, action: "package_view", metadata: entry.metadata ?? {}, created_at: new Date().toISOString() }); }
export async function auditPackageDownload(entry: PackageAuditEntry & { resourceType: string }, sb: SB): Promise<void> { await sb.from("marketplace_audit_log").insert({ deal_id: entry.dealId, actor_bank_id: entry.actor, actor_scope: entry.actorScope, action: "package_download", metadata: { resourceType: entry.resourceType, ...entry.metadata }, created_at: new Date().toISOString() }); }
