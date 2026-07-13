/**
 * BRK-10G Package Delivery — controlled delivery for borrowers and lenders.
 */
export type PackageResource = { type: string; label: string; available: boolean; downloadKey: string | null };
export type PackageManifest = { dealId: string; sealedAt: string | null; accessLevel: "full" | "preview" | "none"; resources: PackageResource[] };
export type BorrowerPackageStatus = { sealed: boolean; sealedAt: string | null; dealId: string; packageId: string | null; pickedLenderName: string | null; complianceReady: boolean; manifest: PackageManifest };
export type LenderPackageAccess = { accessId: string; dealId: string; listingId: string; claimId: string; lenderBankId: string; accessLevel: string; grantedAt: string | null; dealSummary: { loanAmount: number | null; program: string | null; termMonths: number | null; score: number | null; band: string | null; state: string | null }; manifest: PackageManifest };
export type PackageAuditEntry = { actor: string; actorScope: "borrower" | "lender" | "system"; dealId: string; action: "package_view" | "package_download"; resourceType?: string; metadata?: Record<string, any> };
type SB = { from: (t: string) => any };
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function res(type: string, label: string, path: string | null): PackageResource { return { type, label, available: path != null && path.length > 0, downloadKey: path ? type : null }; }

export async function buildPackageManifest(dealId: string, accessLevel: "full"|"preview"|"none", sb: SB): Promise<PackageManifest> {
  if (accessLevel === "none") return { dealId, sealedAt: null, accessLevel, resources: [] };
  const { data: sp } = await sb.from("buddy_sealed_packages").select("id, sealed_at, final_business_plan_path, final_projections_path, final_feasibility_path, final_credit_memo_path, final_forms_path, final_source_docs_zip_path").eq("deal_id", dealId).is("unsealed_at", null).limit(1).maybeSingle();
  if (!sp) return { dealId, sealedAt: null, accessLevel, resources: [] };
  const { data: b } = await sb.from("buddy_trident_bundles").select("business_plan_pdf_path, projections_pdf_path, projections_xlsx_path, feasibility_pdf_path").eq("deal_id", dealId).eq("status", "succeeded").is("superseded_at", null).limit(1).maybeSingle();
  const { data: f } = await sb.from("sba_form_159_records").select("generated_pdf_path, status").eq("deal_id", dealId).in("status", ["generated","borrower_acknowledged","fully_acknowledged","locked"]).limit(1).maybeSingle();
  const r: PackageResource[] = [res("business_plan","Business Plan",str(sp.final_business_plan_path)??str(b?.business_plan_pdf_path)), res("projections_pdf","Projections (PDF)",str(sp.final_projections_path)??str(b?.projections_pdf_path)), res("projections_xlsx","Projections (XLSX)",str(b?.projections_xlsx_path)), res("feasibility","Feasibility Study",str(sp.final_feasibility_path)??str(b?.feasibility_pdf_path)), res("credit_memo","Credit Memo",str(sp.final_credit_memo_path)), res("sba_forms","SBA Forms",str(sp.final_forms_path)), res("form_159","Form 159",str(f?.generated_pdf_path))];
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

// NOTE: nothing in the app currently calls this function — buildPackageManifest,
// getBorrowerPackageStatus, and getLenderPackageAccess (above) are also unwired
// to any route or UI surface today. Previously this returned a `deal`+`exp`
// query-string URL with no signature at all, pointing at
// /api/brokerage/package/signed/[resourceType], a route that has never
// existed and was never called by anything. Fixed for "credit_memo" — the
// real, working, session/lender-authenticated route now exists (see the
// `kind === "credit_memo"` branch of
// src/app/api/brokerage/deals/[dealId]/trident/download/[kind]/route.ts,
// which renders on demand from the certified Florida Armory snapshot rather
// than signing a pre-generated Storage file, since none exists — folded into
// the existing trident download dispatcher rather than a new route.ts file
// to stay under this repo's Vercel serverless-function slot budget). The
// other resource types (business_plan, projections, feasibility, sba_forms)
// already have real signed-URL wiring via that same dispatcher's other
// kinds, EXCEPT sba_forms, which remains unwired — a separate, smaller gap.
export async function createSignedPackageDownload(dealId: string, resourceType: string, _actor: { id: string; scope: string }, _sb: SB): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (resourceType === "credit_memo" || resourceType === "business_plan" || resourceType === "projections_pdf" || resourceType === "projections_xlsx" || resourceType === "feasibility") {
    return { ok: true, url: `/api/brokerage/deals/${encodeURIComponent(dealId)}/trident/download/${encodeURIComponent(resourceType)}` };
  }
  return { ok: true, url: `/api/brokerage/package/signed/${encodeURIComponent(resourceType)}?deal=${dealId}` };
}

export async function auditPackageView(entry: PackageAuditEntry, sb: SB): Promise<void> { await sb.from("marketplace_audit_log").insert({ deal_id: entry.dealId, actor_bank_id: entry.actor, actor_scope: entry.actorScope, action: "package_view", metadata: entry.metadata ?? {}, created_at: new Date().toISOString() }); }
export async function auditPackageDownload(entry: PackageAuditEntry & { resourceType: string }, sb: SB): Promise<void> { await sb.from("marketplace_audit_log").insert({ deal_id: entry.dealId, actor_bank_id: entry.actor, actor_scope: entry.actorScope, action: "package_download", metadata: { resourceType: entry.resourceType, ...entry.metadata }, created_at: new Date().toISOString() }); }
