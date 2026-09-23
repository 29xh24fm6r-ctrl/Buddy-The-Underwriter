import "server-only";
import { packageRecoveryItems, borrowerResearchWarning } from "@/lib/borrower/guidedPackage/packageRecovery";
import { packageCompletionItems, borrowerPackageFailure } from "@/lib/borrower/guidedPackage/completion";
import { loadGuidedPackage } from "@/lib/borrower/guidedPackage/service";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assumptionsInput } from "@/lib/sba/assumptionsInput";
import { validateSBAAssumptions } from "@/lib/sba/sbaAssumptionsValidator";
import { draftAssumptionsFromContext } from "@/lib/sba/sbaAssumptionDrafter";
import { getTridentReadiness } from "./trident/tridentReadiness";
import { getBorrowerArtifactRelease } from "./borrowerArtifactRelease";
import { readBorrowerPackagePreparation, startBorrowerPackagePreparation } from "./borrowerPackagePreparation";
import { readPackageCapacity } from "./trident/packageBudget";
import { checkBorrowerPackageEvidence } from "./borrowerPackagePreflight";

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
    const [readiness, answers, capacity] = generating
      ? [null, null, null]
      : await Promise.all([
          getTridentReadiness({ sb, dealId, bankId }),
          loadGuidedPackage(sb, { deal_id: dealId, bank_id: bankId }),
          readPackageCapacity({ dealId, bankId }, sb),
        ]);
    const completion = answers ? packageCompletionItems(answers) : [];
    if (readiness?.budget && !readiness.budget.balanced) completion.push({
      id: "project-budget", questionId: "loan.use_of_proceeds", label: readiness.budget.message,
    });
    const packageFiles = [
      ["business_plan_pdf_path", "Business plan"],
      ["projections_xlsx_path", "Projections and assumptions"],
      ["feasibility_pdf_path", "Feasibility study"],
      ["credit_memo_pdf_path", "Credit memo"],
      ["spreads_pdf_path", "Financial spreads"],
      ["sba_forms_pdf_path", "Applicable SBA forms"],
    ] as const;
    const release = await getBorrowerArtifactRelease(dealId, sb);
    return NextResponse.json({
      ok: true,
      // Status is useful before release. Storage paths and underwriting output are not.
      bundle: bundle ? {
        id: bundle.id, status: bundle.status, current_stage: bundle.current_stage,
        generation_error: bundle.status === "failed" ? borrowerPackageFailure(bundle.generation_error) : null,
        generation_completed_at: bundle.generation_completed_at,
      } : null,
      release,
      preparation,
      recoveryItems: !generating && bundle?.status === "failed"
        ? packageRecoveryItems(bundle.generation_error, readiness?.evidence.isTestDeal === true) : [],
      readiness: {
        capacity,
        readyToPrepare:
          !generating && capacity?.available === true && readiness?.preparationReady === true &&
          completion.length === 0 && !(answers?.readErrors.length ?? 0),
        readyToGenerate:
          !generating && capacity?.available === true &&
          readiness?.ok === true &&
          completion.length === 0 &&
          !(answers?.readErrors.length ?? 0),
        blockers: [...new Set([
          ...(answers?.readErrors.length
            ? ["Your saved answers could not be verified. Reload before continuing."]
            : []),
          ...completion.map(item => item.label),
          ...(generating ? [] : (readiness?.preparationBlockers ?? [])),
        ])],
        completionItems: completion,
        budget: readiness?.budget ?? null,
        warnings: [...new Set((readiness?.warnings ?? []).map(borrowerResearchWarning))],
        evidence: readiness?.evidence ?? {},
        packageFiles: packageFiles.map(([key, label]) => ({
          key,
          label,
          ready: Boolean(bundle?.[key]),
        })),
      },
    });
  }
  if (action === "build-package" || action === "check-package") {
    const readiness = await getTridentReadiness({ sb, dealId, bankId });
    const answers = await loadGuidedPackage(sb, {
      deal_id: dealId,
      bank_id: bankId,
    });
    const completion = packageCompletionItems(answers);
    if (answers.readErrors.length)
      return NextResponse.json(
        {
          ok: false,
          error: "Your answers could not be verified. Reload and retry.",
        },
        { status: 503 },
      );
    if (completion.length)
      return NextResponse.json(
        {
          ok: false,
          error: "Complete the listed questions and poster acknowledgment before preparing your package.",
          blockers: completion.map(item => item.label),
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
    if (action === "check-package") {
      // The check never queues research/generation or changes persisted verdicts.
      if (!readiness.ok) return NextResponse.json({ ok: true, check: {
        checkedAt: new Date().toISOString(), status: "not_checked", recoveryItems: [],
        message: "Package preparation still needs to complete financial validation and business research before saved package evidence can be checked. No AI work was started.",
      } });
      return NextResponse.json({ ok: true, check: await checkBorrowerPackageEvidence(dealId, bankId, readiness.evidence.isTestDeal === true) });
    }
    const capacity = await readPackageCapacity({ dealId, bankId }, sb);
    if (!capacity.available) return NextResponse.json({ ok: false, error: capacity.message }, { status: 503 });
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
