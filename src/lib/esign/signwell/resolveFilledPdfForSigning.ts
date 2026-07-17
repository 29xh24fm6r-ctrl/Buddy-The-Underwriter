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

/**
 * SPEC-SBA-DOC-FILL-ESIGN-KYC-V2 §4/§5 — the resolver SignWell signing
 * actually needs: given an esign formCode + deal + signer, produce the
 * already-filled PDF bytes so SignWell only ever adds a signature, never
 * loan data. Reuses the same build*Input -> build* -> render*Pdf pipeline
 * /api/deals/[dealId]/sba/forms/[formId]/render already exercises
 * (src/lib/sba/forms/*​/{inputBuilder,build,render}.ts) — this is not a new
 * fill engine, just a formCode -> form-module dispatch for the subset of
 * forms the signing panel currently tracks (FORM_1919, FORM_413, FORM_912,
 * FORM_4506C — see TRACKED_FORMS in SbaSigningPanel.tsx).
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
      const rendered = await renderForm1919Pdf({ supabase, buildResult });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    case "FORM_413": {
      const input = await buildForm413Input(dealId, sb);
      const buildResult = buildForm413(input);
      const rendered = await renderForm413Pdf({ supabase, buildResult, ownershipEntityId });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    case "FORM_912": {
      const input = await buildForm912Input(dealId, sb);
      const buildResult = buildForm912(input);
      const rendered = await renderForm912Pdf({ supabase, buildResult, ownershipEntityId });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    case "FORM_4506C": {
      const input = await buildForm4506cInput(dealId, bankId, sb);
      const buildResult = buildForm4506c(input);
      const rendered = await renderForm4506cPdf({ supabase, buildResult, ownershipEntityId });
      return rendered.ok
        ? { ok: true, pdfBytes: rendered.pdfBytes }
        : { ok: false, reason: rendered.reason, detail: rendered.detail };
    }

    default:
      return { ok: false, reason: "UNSUPPORTED_FORM_CODE" };
  }
}
