import "server-only";

/**
 * SPEC S5 A-6 — third-party orchestration routes, consolidated into one
 * dynamic-segment file (route-budget discipline established in Phase 4/5
 * of this arc — see routeConsolidationGuard.test.ts's warning-threshold
 * finding in the Drift Log).
 *
 * GET  /api/deals/[dealId]/third-party/orders           -> list orders
 * POST /api/deals/[dealId]/third-party/evaluate          -> run trigger engine
 * POST /api/deals/[dealId]/third-party/dispatch?orderId=...  (+ vendor_id in body)
 * POST /api/deals/[dealId]/third-party/ingest?orderId=...    (multipart file upload)
 * POST /api/deals/[dealId]/third-party/cancel?orderId=...    (+ reason in body)
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { evaluateAndCreateTriggers, dispatchOrder, ingestResult, cancelOrder } from "@/lib/thirdParty/orchestrator";
import { buildSbaEligibilityInput } from "@/lib/sba/dealDataBuilder";
import { getEmailProvider } from "@/lib/email/getProvider";
import { buildAppraisalOrderEmail } from "@/lib/thirdParty/emailTemplates/appraisal-order.eml";
import { buildValuationOrderEmail } from "@/lib/thirdParty/emailTemplates/valuation-order.eml";
import { buildEnvironmentalOrderEmail } from "@/lib/thirdParty/emailTemplates/environmental-order.eml";
import { buildTitleCommitmentOrderEmail } from "@/lib/thirdParty/emailTemplates/title-commitment-order.eml";
import { buildUccSearchOrderEmail } from "@/lib/thirdParty/emailTemplates/ucc-search-order.eml";
import { buildInsuranceBinderRequestEmail } from "@/lib/thirdParty/emailTemplates/insurance-binder-request.eml";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; action: string }> };

const REAL_ESTATE_PATTERN = /real estate|land|building purchase|construction/i;

function buildOrderEmail(args: { orderType: string; vendorName: string; orderMetadata: Record<string, unknown> }): { subject: string; body: string } {
  const businessLegalName = String(args.orderMetadata.business_legal_name ?? "the borrower");
  const loanAmount = Number(args.orderMetadata.loan_amount ?? 0);
  const dealReferenceId = String(args.orderMetadata.deal_reference_id ?? "");
  const propertyAddress = String(args.orderMetadata.property_address ?? "TBD");

  switch (args.orderType) {
    case "real_estate_appraisal":
      return buildAppraisalOrderEmail({ vendorName: args.vendorName, businessLegalName, propertyAddress, loanAmount, dealReferenceId });
    case "business_valuation":
      return buildValuationOrderEmail({ vendorName: args.vendorName, businessLegalName, loanAmount, dealReferenceId });
    case "phase_1_environmental":
      return buildEnvironmentalOrderEmail({ vendorName: args.vendorName, businessLegalName, propertyAddress, naicsCode: (args.orderMetadata.naics_code as string) ?? null, dealReferenceId });
    case "title_commitment":
      return buildTitleCommitmentOrderEmail({ vendorName: args.vendorName, businessLegalName, propertyAddress, dealReferenceId });
    case "ucc_lien_search":
      return buildUccSearchOrderEmail({ vendorName: args.vendorName, businessLegalName, stateOfFormation: (args.orderMetadata.state_of_formation as string) ?? null, dealReferenceId });
    case "hazard_insurance":
    case "life_insurance":
      return buildInsuranceBinderRequestEmail({ vendorName: args.vendorName, businessLegalName, insuranceType: args.orderType, loanAmount, dealReferenceId });
    default:
      return { subject: `Order request — ${businessLegalName}`, body: `Order type: ${args.orderType}\nReference: ${dealReferenceId}` };
  }
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId, action } = await ctx.params;
    const { dealId } = await requireDealAccess(rawDealId);

    if (action !== "orders") {
      return NextResponse.json({ ok: false, error: `unsupported_action: ${action}` }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data: orders } = await sb.from("third_party_orders").select("*").eq("deal_id", dealId).order("triggered_at", { ascending: false });
    return NextResponse.json({ ok: true, orders: orders ?? [] });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/third-party/[action]] GET", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId, action } = await ctx.params;
    const { dealId, bankId, userId } = await requireDealAccess(rawDealId);
    const sb = supabaseAdmin();
    const orderId = new URL(req.url).searchParams.get("orderId");

    if (action === "evaluate") {
      const { data: deal } = await sb.from("deals").select("loan_amount, deal_type, borrower_id").eq("id", dealId).maybeSingle();
      const { data: loanRequest } = await sb
        .from("deal_loan_requests")
        .select("requested_amount, use_of_proceeds")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: borrower } = deal?.borrower_id ? await sb.from("borrowers").select("naics_code").eq("id", deal.borrower_id).maybeSingle() : { data: null };

      const eligibilityInput = await buildSbaEligibilityInput(dealId, sb);
      const useOfProceeds = Array.isArray(loanRequest?.use_of_proceeds) ? loanRequest.use_of_proceeds : [];
      const realEstateInUseOfProceeds = useOfProceeds.some(
        (l: any) => (l?.category && REAL_ESTATE_PATTERN.test(l.category)) || (l?.description && REAL_ESTATE_PATTERN.test(l.description)),
      );

      const result = await evaluateAndCreateTriggers(
        dealId,
        bankId,
        {
          loanAmount: (loanRequest?.requested_amount ?? deal?.loan_amount ?? 0) as number,
          loanProgram: (deal?.deal_type ?? "") as string,
          isAcquisition: Boolean(eligibilityInput.is_acquisition),
          isSingleOwnerBusiness: Boolean(eligibilityInput.is_single_owner_business),
          loanFullySecuredByHardCollateral: Boolean(eligibilityInput.loan_fully_secured_by_hard_collateral),
          realEstateInUseOfProceeds,
          businessNaics: (borrower as { naics_code?: string } | null)?.naics_code ?? null,
        },
        { sb },
      );

      return NextResponse.json({ ok: true, ...result });
    }

    if (!orderId) {
      return NextResponse.json({ ok: false, error: "missing_orderId_query_param" }, { status: 400 });
    }

    if (action === "dispatch") {
      const body = await req.json().catch(() => ({}) as Record<string, unknown>);
      const vendorId = typeof body.vendor_id === "string" ? body.vendor_id : "";
      if (!vendorId) return NextResponse.json({ ok: false, error: "missing_vendor_id" }, { status: 400 });

      const { data: deal } = await sb.from("deals").select("loan_amount, borrower_id").eq("id", dealId).maybeSingle();
      const { data: borrower } = deal?.borrower_id ? await sb.from("borrowers").select("legal_name").eq("id", deal.borrower_id).maybeSingle() : { data: null };

      const result = await dispatchOrder(
        { orderId, vendorId, orderedByUserId: userId, orderMetadata: { business_legal_name: (borrower as { legal_name?: string } | null)?.legal_name, loan_amount: deal?.loan_amount, deal_reference_id: dealId } },
        { sb, email: getEmailProvider(), emailFrom: process.env.EMAIL_FROM || "noreply@buddytheunderwriter.com", buildEmail: buildOrderEmail },
      );

      if (!result.ok) {
        const status = result.reason === "ORDER_NOT_FOUND" || result.reason === "VENDOR_NOT_FOUND" ? 404 : 502;
        return NextResponse.json({ ok: false, error: result.reason, detail: result.detail }, { status });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "ingest") {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
      }
      const resultParsedJsonRaw = form.get("result_parsed_json");
      const resultParsedJson = typeof resultParsedJsonRaw === "string" ? JSON.parse(resultParsedJsonRaw) : undefined;

      const fileBytes = Buffer.from(await file.arrayBuffer());
      const result = await ingestResult({ orderId, fileBytes, fileName: file.name, contentType: file.type || "application/pdf", resultParsedJson }, { sb });

      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.reason, detail: result.detail }, { status: result.reason === "ORDER_NOT_FOUND" ? 404 : 502 });
      }
      return NextResponse.json({ ok: true, storagePath: result.storagePath });
    }

    if (action === "cancel") {
      const body = await req.json().catch(() => ({}) as Record<string, unknown>);
      const reason = typeof body.reason === "string" ? body.reason : "No reason given";
      const result = await cancelOrder({ orderId, reason }, { sb });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.reason }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: `unsupported_action: ${action}` }, { status: 400 });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/third-party/[action]] POST", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
