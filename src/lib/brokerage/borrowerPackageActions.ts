import "server-only";
import { loadGuidedPackage } from "@/lib/borrower/guidedPackage/service";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assumptionsInput } from "@/lib/sba/assumptionsInput";
import { validateSBAAssumptions } from "@/lib/sba/sbaAssumptionsValidator";
import { draftAssumptionsFromContext } from "@/lib/sba/sbaAssumptionDrafter";
import { getTridentReadiness } from "./trident/tridentReadiness";
import { readBorrowerPackagePreparation, startBorrowerPackagePreparation } from "./borrowerPackagePreparation";

export async function borrowerPackageAction(
  action: string,
  dealId: string,
  bankId: string,
  body?: Record<string, unknown>,
) {
  const sb = supabaseAdmin();
  if (action === "package-status") {
    const preparation = await readBorrowerPackagePreparation(dealId, bankId);
    const bundleResult = await sb
      .from("buddy_trident_bundles")
      .select(
        "id,status,current_stage,generation_error,generation_completed_at,lease_expires_at,business_plan_pdf_path,projections_xlsx_path,feasibility_pdf_path,credit_memo_pdf_path,spreads_pdf_path,sba_forms_pdf_path",
      )
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("mode", "final")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: bundle, error } = bundleResult;
    if (error) throw new Error("Your package status could not be loaded");
    if (bundle && ["pending", "running"].includes(bundle.status) &&
      bundle.lease_expires_at && Date.parse(bundle.lease_expires_at) <= Date.now()) {
      bundle.status = "failed";
      bundle.generation_error = "Package preparation stopped before completion. Please retry.";
    }
    const generating = preparation?.status === "running" || ["pending", "running"].includes(bundle?.status ?? "");
    const [readiness, answers] = generating
      ? [null, null]
      : await Promise.all([
          getTridentReadiness({ sb, dealId, bankId }),
          loadGuidedPackage(sb, { deal_id: dealId, bank_id: bankId }),
        ]);
    const unanswered = (answers?.questions ?? []).filter(
      (q) =>
        q.responsibility === "borrower" &&
        q.required &&
        !["saved", "not_applicable"].includes(q.state),
    );
    const packageFiles = [
      ["business_plan_pdf_path", "Business plan"],
      ["projections_xlsx_path", "Projections and assumptions"],
      ["feasibility_pdf_path", "Feasibility study"],
      ["credit_memo_pdf_path", "Credit memo"],
      ["spreads_pdf_path", "Financial spreads"],
      ["sba_forms_pdf_path", "Applicable SBA forms"],
    ] as const;
    return NextResponse.json({
      ok: true,
      bundle,
      preparation,
      readiness: {
        readyToPrepare:
          !generating && readiness?.preparationReady === true &&
          unanswered.length === 0 && !(answers?.readErrors.length ?? 0),
        readyToGenerate:
          !generating &&
          readiness?.ok === true &&
          unanswered.length === 0 &&
          !(answers?.readErrors.length ?? 0),
        blockers: [
          ...(answers?.readErrors.length
            ? ["Your saved answers could not be verified. Reload before continuing."]
            : []),
          ...unanswered.slice(0, 8).map((q) => q.question),
          ...(generating ? [] : (readiness?.preparationBlockers ?? [])),
        ],
        warnings: readiness?.warnings ?? [],
        evidence: readiness?.evidence ?? {},
        packageFiles: packageFiles.map(([key, label]) => ({
          key,
          label,
          ready: Boolean(bundle?.[key]),
        })),
      },
    });
  }
  if (action === "build-package") {
    const readiness = await getTridentReadiness({ sb, dealId, bankId });
    const answers = await loadGuidedPackage(sb, {
      deal_id: dealId,
      bank_id: bankId,
    });
    const unanswered = answers.questions.filter(
      (q) =>
        q.responsibility === "borrower" &&
        q.required &&
        !["saved", "not_applicable"].includes(q.state),
    );
    if (answers.readErrors.length)
      return NextResponse.json(
        {
          ok: false,
          error: "Your answers could not be verified. Reload and retry.",
        },
        { status: 503 },
      );
    if (unanswered.length)
      return NextResponse.json(
        {
          ok: false,
          error: `${unanswered.length} required answers remain. Please return to your questions.`,
          blockers: unanswered.slice(0, 8).map((q) => q.question),
        },
        { status: 409 },
      );
    if (!readiness.preparationReady)
      return NextResponse.json(
        {
          ok: false,
          error: "Please complete these items first.",
          blockers: readiness.preparationBlockers,
        },
        { status: 409 },
      );
    const started = await startBorrowerPackagePreparation(dealId, bankId);
    return NextResponse.json(started, { status: started.ok ? 202 : 503 });
  }
  const { data: row, error } = await sb
    .from("buddy_sba_assumptions")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (error) throw new Error("Your assumptions could not be loaded");
  const revision = row?.updated_at ?? null;
  if (action === "assumptions" && !body) {
    return NextResponse.json({
      ok: true,
      revision,
      assumptions: row
        ? {
            revenueStreams: row.revenue_streams,
            costAssumptions: row.cost_assumptions,
            workingCapital: row.working_capital,
            loanImpact: row.loan_impact,
            managementTeam: row.management_team,
          }
        : null,
      status: row?.status ?? "draft",
    });
  }
  if (action === "draft-assumptions") {
    const draft = await draftAssumptionsFromContext(dealId);
    return NextResponse.json({
      ok: true,
      revision,
      assumptions: draft.assumptions,
      reasoning: draft.reasoning,
      status: "draft",
    });
  }
  if (action === "assumptions" && body) {
    if (body.revision !== revision)
      return NextResponse.json(
        {
          ok: false,
          error:
            "These assumptions changed in another session. Reload before saving.",
        },
        { status: 409 },
      );
    const parsed = assumptionsInput.safeParse(body.assumptions);
    if (!parsed.success)
      return NextResponse.json(
        {
          ok: false,
          error: "Check your assumption values.",
          blockers: parsed.error.issues.map(
            (i) => `${i.path.join(" / ")}: ${i.message}`,
          ),
        },
        { status: 422 },
      );
    const status = body.confirmed === true ? "confirmed" : "draft";
    const validation = validateSBAAssumptions({
      ...parsed.data,
      dealId,
      status,
    });
    if (status === "confirmed" && !validation.ok)
      return NextResponse.json(
        {
          ok: false,
          error: "Complete your assumptions before confirming.",
          blockers: validation.blockers,
        },
        { status: 422 },
      );
    const now = new Date().toISOString();
    const a = parsed.data;
    const values = {
      deal_id: dealId,
      status,
      updated_at: now,
      confirmed_at: status === "confirmed" ? now : null,
      revenue_streams: a.revenueStreams,
      cost_assumptions: a.costAssumptions,
      working_capital: a.workingCapital,
      loan_impact: a.loanImpact,
      management_team: a.managementTeam,
    };
    const write = row
      ? sb
          .from("buddy_sba_assumptions")
          .update(values)
          .eq("deal_id", dealId)
          .eq("updated_at", revision)
      : sb.from("buddy_sba_assumptions").insert(values);
    const { data: saved, error: saveError } = await write
      .select("id,updated_at,status")
      .maybeSingle();
    if (saveError || !saved)
      return NextResponse.json(
        {
          ok: false,
          error:
            "Your assumptions could not be saved or changed in another session. Reload and retry.",
        },
        { status: 409 },
      );
    return NextResponse.json({
      ok: true,
      assumptions: a,
      status: saved.status,
      revision: saved.updated_at,
    });
  }
  return NextResponse.json({ ok: false }, { status: 404 });
}
