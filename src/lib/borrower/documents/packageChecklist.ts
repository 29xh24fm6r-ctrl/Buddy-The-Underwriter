import "server-only";
import { isDocValidForChecklistKey } from "@/lib/checklist/docValidity";
import { packageBusinessStage } from "@/lib/modelEngine/packageBusinessStage";
import { ENTITY_SCOPED_DOC_TYPES } from "@/lib/intake/identity/entityScopedDocTypes";

type Row = Record<string, any>;
export type PackageDocumentItem = { key: string; title: string; state: "complete" | "missing" | "not_applicable" | "prepared_by_buddy"; detail: string };
export type PackageDocumentReadiness = { ok: boolean; reasons: string[]; items: PackageDocumentItem[] };

/** Read the canonical checklist; never infer completion from a file count or
 * filename. No processing, model calls, status writes, or staff-only checks. */
export async function readPackageDocumentReadiness(dealId: string, sb: { from: (table: string) => any }, phase: "prepare" | "submit" = "submit"): Promise<PackageDocumentReadiness> {
  try {
    const [checklist, documents, interview, runs] = await Promise.all([
      sb.from("deal_checklist_items").select("checklist_key,title,required,status,required_years,satisfied_years,received_document_id").eq("deal_id", dealId),
      sb.from("deal_documents").select("id,checklist_key,canonical_type,document_type,quality_status,is_active,finalized_at,intake_status,storage_path,doc_year,doc_years,logical_key").eq("deal_id", dealId),
      sb.from("borrower_concierge_sessions").select("confirmed_facts").eq("deal_id", dealId).maybeSingle(),
      sb.from("sba_package_runs").select("id").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if ([checklist, documents, interview, runs].some(r => r.error)) throw new Error("read_failed");
    const forms = runs.data ? await sb.from("sba_package_run_items").select("template_code,status,output_storage_path").eq("package_run_id", runs.data.id) : { data: [], error: null };
    if (forms.error) throw new Error("forms_read_failed");
    return evaluatePackageDocuments(checklist.data ?? [], documents.data ?? [], interview.data?.confirmed_facts, forms.data ?? [], phase);
  } catch {
    return { ok: false, reasons: ["Your required-document checklist could not be verified. Refresh and try again."], items: [] };
  }
}

export function evaluatePackageDocuments(checklist: Row[], documents: Row[], facts: unknown, forms: Row[], phase: "prepare" | "submit" = "submit"): PackageDocumentReadiness {
  if (!checklist.length || !checklist.some(r => r.required === true)) return { ok: false, reasons: ["Your required-document checklist is not available yet. Refresh before continuing."], items: [] };
  const startup = packageBusinessStage(facts) === "pre_opening";
  const items: PackageDocumentItem[] = checklist.filter(r => r.required === true).map(row => {
    const key = String(row.checklist_key ?? "");
    const title = String(row.title || key || "Required document");
    if (startup && ["IRS_BUSINESS_3Y", "FIN_STMT_PL_YTD"].includes(key)) return { key, title, state: "not_applicable", detail: "Confirmed pre-opening business: historical operating records do not exist yet." };
    // The existing form factory owns form applicability and per-owner expansion.
    // It must finish before submission, but requiring its outputs at admission
    // would make first-time package preparation impossible.
    const code = key === "PFS_CURRENT" ? "SBA_413" : key;
    const formRows = forms.filter(f => f.template_code === code);
    const generated = formRows.length > 0 && formRows.every(f => f.status === "generated" && f.output_storage_path);
    if (generated) return { key, title, state: "complete", detail: "Prepared by Buddy from your saved answers." };
    if (phase === "prepare" && ["PFS_CURRENT", "SBA_413", "SBA_1919", "SBA_1244"].includes(key)) return { key, title, state: "prepared_by_buddy", detail: "Buddy prepares this form from your completed application." };
    if (row.status === "waived") return { key, title, state: "not_applicable", detail: "An existing checklist waiver applies." };
    const matches = documents.filter(d => isDocValidForChecklistKey(d, key) && d.is_active === true && d.storage_path &&
      !String(d.quality_status ?? "").match(/FAILED|REJECTED|ERROR/i) &&
      (!ENTITY_SCOPED_DOC_TYPES.has(String(d.canonical_type ?? d.document_type ?? "")) || !!d.logical_key) &&
      (d.finalized_at || d.intake_status === "USER_CONFIRMED"));
    const years = new Set(matches.flatMap(d => [...(Array.isArray(d.doc_years) ? d.doc_years : []), d.doc_year]).filter(y => Number.isInteger(y)));
    const requiredYears = Array.isArray(row.required_years) ? row.required_years.filter((y: unknown) => Number.isInteger(y)) : [];
    const yearBased = /^IRS_|_\dY\b/.test(key);
    const missingYears = requiredYears.filter((y: number) => !years.has(y));
    const complete = matches.length > 0 && (!yearBased || (requiredYears.length > 0 && missingYears.length === 0));
    return { key, title, state: complete ? "complete" : "missing", detail: complete ? "Confirmed uploaded evidence is available." : missingYears.length ? `Upload and confirm returns for ${missingYears.join(", ")}.` : yearBased && !requiredYears.length ? "The requested tax years need to be confirmed before continuing." : "Upload this document and resolve any processing or review requests." };
  });
  const reasons = items.filter(i => i.state === "missing").map(i => `${i.title}: ${i.detail}`);
  return { ok: reasons.length === 0, reasons, items };
}
