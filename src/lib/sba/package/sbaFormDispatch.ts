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
import { buildSbaNoteWithSignature } from "@/lib/sba/forms/sbaNote/buildWithSignature";
import { renderSbaNotePdf } from "@/lib/sba/forms/sbaNote/render";
import { buildLoanAuthorizationWithSignature } from "@/lib/sba/forms/loanAuthorization/buildWithSignature";
import { renderLoanAuthorizationPdf } from "@/lib/sba/forms/loanAuthorization/render";

/**
 * Dispatches an SBA package item's `template_code` to the real,
 * fully-fielded form module. When `ownershipEntityId` is provided,
 * per-owner forms (413, 912, 4506-C, 148, 148L) render for that specific
 * owner; otherwise they fall back to the first qualifying signer.
 */

export type SbaFormDispatchResult =
  | { ok: true; pdfBytes: Buffer }
  | { ok: true; storagePath: string }
  | { ok: false; reason: string };

const DISPATCHED_TEMPLATE_CODES = new Set([
  "SBA_1919", "SBA_1244", "SBA_413", "SBA_912", "SBA_155", "SBA_159", "IRS_4506C",
  "SBA_148", "SBA_148L", "SBA_601", "SBA_722", "SBA_NOTE", "SBA_AUTHORIZATION",
]);

export function isDispatchedSbaTemplateCode(templateCode: string): boolean {
  return DISPATCHED_TEMPLATE_CODES.has(templateCode);
}

export async function renderSbaPackageItem(
  templateCode: string,
  args: { dealId: string; bankId: string; supabase: SupabaseClient; ownershipEntityId?: string },
): Promise<SbaFormDispatchResult> {
  const { dealId, bankId, supabase, ownershipEntityId } = args;
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
      const signer = ownershipEntityId
        ? buildResult.input.signers.find((s) => s.ownership_entity_id === ownershipEntityId)
        : buildResult.input.signers[0];
      if (!signer) return { ok: false, reason: "no_signers" };
      const rendered = await renderForm413Pdf({ supabase, buildResult, ownershipEntityId: signer.ownership_entity_id, dealId });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    case "SBA_912": {
      const buildResult = await buildForm912WithSignature(dealId, sb);
      if (!buildResult.applicable) return { ok: false, reason: "not_applicable" };
      const person = ownershipEntityId
        ? buildResult.input.persons.find((p) => p.ownership_entity_id === ownershipEntityId)
        : buildResult.input.persons[0];
      if (!person) return { ok: false, reason: "no_triggering_persons" };
      const rendered = await renderForm912Pdf({ supabase, buildResult, ownershipEntityId: person.ownership_entity_id, dealId });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    case "IRS_4506C": {
      const buildResult = await buildForm4506cWithSignature(dealId, bankId, sb);
      const signer = ownershipEntityId
        ? buildResult.input.signers.find((s) => s.ownership_entity_id === ownershipEntityId)
        : buildResult.input.signers[0];
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
      const signer = ownershipEntityId
        ? buildResult.input.signers.find((s) => s.ownership_entity_id === ownershipEntityId && s.guaranteeType === "unconditional")
        : buildResult.input.signers.find((s) => s.guaranteeType === "unconditional");
      if (!signer) return { ok: false, reason: "not_applicable" };
      const rendered = await renderForm148Pdf({ supabase, buildResult, ownershipEntityId: signer.ownership_entity_id });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    case "SBA_148L": {
      const buildResult = await buildForm148WithSignature(dealId, bankId, sb);
      const signer = ownershipEntityId
        ? buildResult.input.signers.find((s) => s.ownership_entity_id === ownershipEntityId && s.guaranteeType === "limited")
        : buildResult.input.signers.find((s) => s.guaranteeType === "limited");
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

    case "SBA_NOTE": {
      const buildResult = await buildSbaNoteWithSignature(dealId, bankId, sb);
      if (!buildResult.is_complete) return { ok: false, reason: `form_incomplete: ${buildResult.missing.join(",")}` };
      const rendered = await renderSbaNotePdf({ buildResult });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    case "SBA_AUTHORIZATION": {
      const buildResult = await buildLoanAuthorizationWithSignature(dealId, bankId, sb);
      if (!buildResult.is_complete) return { ok: false, reason: `form_incomplete: ${buildResult.missing.join(",")}` };
      const rendered = await renderLoanAuthorizationPdf({ buildResult });
      return rendered.ok ? { ok: true, pdfBytes: rendered.pdfBytes } : { ok: false, reason: rendered.reason };
    }

    default:
      return { ok: false, reason: "no_dispatch_handler" };
  }
}
