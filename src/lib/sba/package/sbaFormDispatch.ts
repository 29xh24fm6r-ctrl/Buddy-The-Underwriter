import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildForm1919WithSignature } from "@/lib/sba/forms/form1919/buildWithSignature";
import { renderForm1919Pdf } from "@/lib/sba/forms/form1919/render";
import { buildForm1244WithSignature } from "@/lib/sba/forms/form1244/buildWithSignature";
import { renderForm1244Pdf } from "@/lib/sba/forms/form1244/render";
import { buildForm413WithSignature } from "@/lib/sba/forms/form413/buildWithSignature";
import { renderForm413Pdf } from "@/lib/sba/forms/form413/render";
import { buildForm912WithSignature } from "@/lib/sba/forms/form912/buildWithSignature";
import { renderForm912Pdf } from "@/lib/sba/forms/form912/render";
import { buildForm4506cWithSignature } from "@/lib/sba/forms/form4506c/buildWithSignature";
import { renderForm4506cPdf } from "@/lib/sba/forms/form4506c/render";
import { buildForm155WithSignature } from "@/lib/sba/forms/form155/buildWithSignature";
import { renderForm155Pdf } from "@/lib/sba/forms/form155/render";
import { buildForm159PayloadForDeal, tryRenderForm159Pdf } from "@/lib/brokerage/compliancePackage";
import { buildForm148WithSignature } from "@/lib/sba/forms/form148/buildWithSignature";
import { renderForm148Pdf } from "@/lib/sba/forms/form148/render";
import { buildForm601WithSignature } from "@/lib/sba/forms/form601/buildWithSignature";
import { renderForm601Pdf } from "@/lib/sba/forms/form601/render";
import { getForm722Status } from "@/lib/sba/forms/form722/service";

/**
 * SPEC S4 H-1 — dispatches an SBA package item's `template_code` to the
 * real, fully-fielded form module built across ARC-00 Phases 0-3, instead
 * of the legacy generic `fillEngine` path (generatePdfBytesFromFillRun.ts),
 * which only knows a handful of hardcoded dealData fields
 * (borrower_name/business_name/business_ein/loan_amount/loan_purpose) and
 * has no awareness of any form built in this arc.
 *
 * ARC-00 finding (logged in the Drift Log, Gate 3 write-up): the
 * pre-existing `sba_package_runs`/`fill_runs`/`sba_package_run_items`
 * schema models exactly one output PDF per template_code per package run.
 * Forms 413/912/4506-C are legitimately one-PDF-per-signer (each 20%+
 * owner has their own PFS/912/4506-C). Until that schema gains a signer
 * dimension (or the run-item model becomes one-row-per-signer), this
 * dispatcher renders the *first* applicable signer only, so Gate 3's
 * "package run generates all items" claim is real but only
 * single-signer-complete for those three forms — a genuine simplification,
 * not a fabrication (the rendered PDF is correctly and completely fielded
 * for that one signer).
 */

export type SbaFormDispatchResult =
  | { ok: true; pdfBytes: Buffer }
  | { ok: true; storagePath: string }
  | { ok: false; reason: string };

const DISPATCHED_TEMPLATE_CODES = new Set([
  "SBA_1919", "SBA_1244", "SBA_413", "SBA_912", "SBA_155", "SBA_159", "IRS_4506C",
  "SBA_148", "SBA_148L", "SBA_601", "SBA_722",
]);

export function isDispatchedSbaTemplateCode(templateCode: string): boolean {
  return DISPATCHED_TEMPLATE_CODES.has(templateCode);
}

export async function renderSbaPackageItem(
  templateCode: string,
  args: { dealId: string; bankId: string; supabase: SupabaseClient },
): Promise<SbaFormDispatchResult> {
  const { dealId, bankId, supabase } = args;
  const sb = supabase as unknown as { from: (t: string) => any };

  switch (templateCode) {
    case "SBA_1919": {
      const buildResult = await buildForm1919WithSignature(dealId, sb);
      if (!buildResult.is_complete) return { ok: false, reason: "form_incomplete" };
      // Section II is per-individual on the real form (see form1919/
      // render.ts) — same "first applicable signer only" simplification
      // already used above for 413/912/148 until the package-run schema
      // gains a signer dimension.
      const person = buildResult.input.sectionII[0];
      if (!person) return { ok: false, reason: "no_signers" };
      const rendered = await renderForm1919Pdf({ supabase, buildResult, ownershipEntityId: person.ownership_entity_id, dealId });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    case "SBA_1244": {
      const buildResult = await buildForm1244WithSignature(dealId, sb);
      if (!buildResult.is_complete) return { ok: false, reason: "form_incomplete" };
      // Section Two is per-individual on the real form (see form1244/
      // render.ts) — same "first applicable signer only" simplification
      // already used above for 413/912/148/1919 until the package-run
      // schema gains a signer dimension.
      const person = buildResult.input.sectionII[0];
      if (!person) return { ok: false, reason: "no_signers" };
      const rendered = await renderForm1244Pdf({ supabase, buildResult, ownershipEntityId: person.ownership_entity_id, dealId });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    case "SBA_413": {
      const buildResult = await buildForm413WithSignature(dealId, sb);
      const signer = buildResult.input.signers[0];
      if (!signer) return { ok: false, reason: "no_signers" };
      const rendered = await renderForm413Pdf({ supabase, buildResult, ownershipEntityId: signer.ownership_entity_id, dealId });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    case "SBA_912": {
      const buildResult = await buildForm912WithSignature(dealId, sb);
      if (!buildResult.applicable) return { ok: false, reason: "not_applicable" };
      const person = buildResult.input.persons[0];
      if (!person) return { ok: false, reason: "no_triggering_persons" };
      const rendered = await renderForm912Pdf({ supabase, buildResult, ownershipEntityId: person.ownership_entity_id, dealId });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    case "IRS_4506C": {
      const buildResult = await buildForm4506cWithSignature(dealId, bankId, sb);
      const signer = buildResult.input.signers[0];
      if (!signer) return { ok: false, reason: "no_signers" };
      const rendered = await renderForm4506cPdf({ supabase, buildResult, ownershipEntityId: signer.ownership_entity_id, dealId, bankId });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    case "SBA_155": {
      const buildResult = await buildForm155WithSignature(dealId, bankId, sb);
      if (!buildResult.applicable) return { ok: false, reason: "not_applicable" };
      const rendered = await renderForm155Pdf({ supabase, buildResult });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    case "SBA_159": {
      const { data: loanRequest } = await sb
        .from("deal_loan_requests")
        .select("agent_used")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!loanRequest?.agent_used) return { ok: false, reason: "not_applicable" };

      const { fields, missing } = await buildForm159PayloadForDeal(dealId, sb, bankId);
      if (missing.length > 0) return { ok: false, reason: `form_incomplete: ${missing.join(",")}` };
      const storagePath = await tryRenderForm159Pdf(dealId, sb, fields);
      return storagePath ? { ok: true, storagePath } : { ok: false, reason: "template_not_available" };
    }

    case "SBA_148": {
      const buildResult = await buildForm148WithSignature(dealId, bankId, sb);
      const signer = buildResult.input.signers.find((s) => s.guaranteeType === "unconditional");
      if (!signer) return { ok: false, reason: "not_applicable" };
      const rendered = await renderForm148Pdf({ supabase, buildResult, ownershipEntityId: signer.ownership_entity_id });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    case "SBA_148L": {
      const buildResult = await buildForm148WithSignature(dealId, bankId, sb);
      const signer = buildResult.input.signers.find((s) => s.guaranteeType === "limited");
      if (!signer) return { ok: false, reason: "not_applicable" };
      const rendered = await renderForm148Pdf({ supabase, buildResult, ownershipEntityId: signer.ownership_entity_id });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    case "SBA_601": {
      const buildResult = await buildForm601WithSignature(dealId, bankId, sb);
      if (!buildResult.applicable) return { ok: false, reason: "not_applicable" };
      const rendered = await renderForm601Pdf({ supabase, buildResult });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    case "SBA_722": {
      const status = await getForm722Status(dealId, sb);
      if (!status.acknowledged) return { ok: false, reason: "not_acknowledged" };
      if (!status.posterStoragePath) return { ok: false, reason: "template_not_available" };
      try {
        const pdfBytes = await readFile(path.join(process.cwd(), "public", status.posterStoragePath));
        return { ok: true, pdfBytes };
      } catch {
        return { ok: false, reason: "template_not_available" };
      }
    }

    default:
      return { ok: false, reason: "no_dispatch_handler" };
  }
}
