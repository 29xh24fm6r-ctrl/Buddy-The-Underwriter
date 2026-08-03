import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildForm1919Input } from "@/lib/sba/forms/form1919/inputBuilder";
import { buildForm1919 } from "@/lib/sba/forms/form1919/build";
import { renderForm1919Pdf } from "@/lib/sba/forms/form1919/render";

import { buildForm413Input } from "@/lib/sba/forms/form413/inputBuilder";
import { buildForm413 } from "@/lib/sba/forms/form413/build";
import { renderForm413Pdf } from "@/lib/sba/forms/form413/render";

import { buildForm912Input } from "@/lib/sba/forms/form912/inputBuilder";
import { buildForm912 } from "@/lib/sba/forms/form912/build";
import { renderForm912Pdf } from "@/lib/sba/forms/form912/render";

import { buildForm4506cInput } from "@/lib/sba/forms/form4506c/inputBuilder";
import { buildForm4506c } from "@/lib/sba/forms/form4506c/build";
import { renderForm4506cPdf } from "@/lib/sba/forms/form4506c/render";

import { buildForm155Input } from "@/lib/sba/forms/form155/inputBuilder";
import { renderForm155Pdf } from "@/lib/sba/forms/form155/render";

import { buildSbaNoteWithSignature } from "@/lib/sba/forms/sbaNote/buildWithSignature";
import { renderSbaNotePdf } from "@/lib/sba/forms/sbaNote/render";

import { buildLoanAuthorizationWithSignature } from "@/lib/sba/forms/loanAuthorization/buildWithSignature";
import { renderLoanAuthorizationPdf } from "@/lib/sba/forms/loanAuthorization/render";

import { buildForm1244Input } from "@/lib/sba/forms/form1244/inputBuilder";
import { buildForm1244 } from "@/lib/sba/forms/form1244/build";
import { renderForm1244Pdf } from "@/lib/sba/forms/form1244/render";

import { buildForm148Input } from "@/lib/sba/forms/form148/inputBuilder";
import { buildForm148 } from "@/lib/sba/forms/form148/build";
import { renderForm148Pdf } from "@/lib/sba/forms/form148/render";

import { buildForm601Input } from "@/lib/sba/forms/form601/inputBuilder";
import { renderForm601Pdf } from "@/lib/sba/forms/form601/render";

import { getForm722Status } from "@/lib/sba/forms/form722/service";

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Given a formCode + deal + signer, produce already-filled PDF bytes for
 * e-signing. Dispatches all 13 SBA form codes to their form modules.
 */
export type ResolveFilledPdfResult =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: string; detail?: string };

export async function resolveFilledPdfForSigning(args: {
  formCode: string;
  dealId: string;
  bankId: string;
  ownershipEntityId: string;
  supabase: SupabaseClient;
}): Promise<ResolveFilledPdfResult> {
  const { formCode, dealId, bankId, ownershipEntityId, supabase } = args;
  const sb = supabase as unknown as { from: (t: string) => any };

  switch (formCode) {
    case "FORM_1919": {
      const input = await buildForm1919Input(dealId, sb);
      const buildResult = buildForm1919(input);
      const rendered = await renderForm1919Pdf({ supabase, buildResult, ownershipEntityId, dealId });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    case "FORM_1244": {
      const input = await buildForm1244Input(dealId, sb);
      const buildResult = buildForm1244(input);
      const rendered = await renderForm1244Pdf({ supabase, buildResult, ownershipEntityId, dealId });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    case "FORM_413": {
      const input = await buildForm413Input(dealId, sb);
      const buildResult = buildForm413(input);
      const rendered = await renderForm413Pdf({ supabase, buildResult, ownershipEntityId, dealId });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    case "FORM_912": {
      const input = await buildForm912Input(dealId, sb);
      const buildResult = buildForm912(input);
      const rendered = await renderForm912Pdf({ supabase, buildResult, ownershipEntityId, dealId });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    case "FORM_4506C": {
      const input = await buildForm4506cInput(dealId, bankId, sb);
      const buildResult = buildForm4506c(input);
      const rendered = await renderForm4506cPdf({ supabase, buildResult, ownershipEntityId, dealId, bankId });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    case "FORM_155": {
      const buildResult = await buildForm155Input(dealId, bankId, sb);
      const rendered = await renderForm155Pdf({ supabase, buildResult });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    case "FORM_SBA_NOTE": {
      const buildResult = await buildSbaNoteWithSignature(dealId, bankId, sb);
      if (!buildResult.is_complete) return { ok: false, reason: "form_incomplete", detail: buildResult.missing.join(",") };
      const rendered = await renderSbaNotePdf({ buildResult });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    case "FORM_SBA_AUTHORIZATION": {
      const buildResult = await buildLoanAuthorizationWithSignature(dealId, bankId, sb);
      if (!buildResult.is_complete) return { ok: false, reason: "form_incomplete", detail: buildResult.missing.join(",") };
      const rendered = await renderLoanAuthorizationPdf({ buildResult });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    case "FORM_148":
    case "FORM_148L": {
      const input = await buildForm148Input(dealId, bankId, sb);
      const buildResult = buildForm148(input);
      const rendered = await renderForm148Pdf({ supabase, buildResult, ownershipEntityId });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    case "FORM_601": {
      const buildResult = await buildForm601Input(dealId, bankId, sb);
      if (!buildResult.applicable) return { ok: false, reason: "not_applicable" };
      const rendered = await renderForm601Pdf({ supabase, buildResult });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    case "FORM_722": {
      const status = await getForm722Status(dealId, sb);
      if (!status.posterAvailable || !status.posterStoragePath) return { ok: false, reason: "template_not_available" };
      try {
        const pdfBytes = await readFile(path.join(process.cwd(), "public", status.posterStoragePath));
        return { ok: true, pdfBytes };
      } catch {
        return { ok: false, reason: "template_not_available" };
      }
    }

    default:
      return { ok: false, reason: "UNSUPPORTED_FORM_CODE" };
  }
}
