import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePackageItems } from "./resolvePackage";
import { buildSbaPackageContext } from "./context";
import { isPerOwnerTemplateCode, expandPerOwnerItems } from "./perOwnerExpansion";

/**
 * Creates an `sba_package_runs` row plus its `sba_package_run_items`,
 * expanding per-owner forms (413, 912, 4506-C, 148, 148L) into one item
 * per (template_code, owner) via expandPerOwnerItems.
 *
 * Each item gets a `fill_runs` row carrying its template_code and
 * ownership_entity_id. That row is the carrier the generate step reads
 * back: generateBrokerageForms takes fill_run_id off the run item and
 * hands it to generatePdfForFillRun, which selects
 * (template_code, ownership_entity_id) from fill_runs and calls
 * renderSbaPackageItem with the right form for the right signer. Without
 * the fill_runs row there is no route from the per-owner expansion to
 * the dispatcher, and the item fails with "Missing fill_run_id".
 *
 * NOTE: public.fill_runs did not exist until 2026-08-01. It was
 * referenced here since 20251218000013_sba_package_builder.sql, which
 * created sba_package_run_items.fill_run_id as a bare `uuid null` with no
 * foreign key and never created the target table — so every call threw
 * `relation "public.fill_runs" does not exist` on the first item and
 * prepareSbaPackage never once completed. The table is now created in
 * 20260807100000_multi_signer_package.sql.
 */
export async function prepareSbaPackage(opts: {
  supabase: SupabaseClient;
  dealId: string;
  token?: string | null;
  packageTemplateCode: string;
  product: "7a" | "504" | "express";
  answers: Record<string, any>;
  borrowerData?: Record<string, any> | null;
}) {
  const { supabase, dealId, token, packageTemplateCode, product, answers, borrowerData } = opts;

  const ctx = buildSbaPackageContext({ dealId, token, product, answers, borrowerData });

  const { data: runRows, error: rErr } = await supabase
    .from("sba_package_runs")
    .insert([
      {
        deal_id: dealId,
        token: token ?? null,
        package_template_code: packageTemplateCode,
        status: "prepared",
        context: ctx,
      },
    ])
    .select("id")
    .limit(1);

  if (rErr) throw new Error(`package_run_insert_failed: ${rErr.message}`);
  const packageRunId = runRows?.[0]?.id as string | undefined;
  if (!packageRunId) throw new Error("package_run_insert_failed: missing id");

  const items = await resolvePackageItems({ supabase, packageTemplateCode, product });

  const sb = supabase as unknown as { from: (t: string) => any };
  const perOwnerCodes = items.filter((it) => isPerOwnerTemplateCode(it.template_code)).map((it) => it.template_code);
  const perOwnerItems = await expandPerOwnerItems(dealId, perOwnerCodes, sb);

  const perOwnerByCode = new Map<string, typeof perOwnerItems>();
  for (const poi of perOwnerItems) {
    const arr = perOwnerByCode.get(poi.templateCode) ?? [];
    arr.push(poi);
    perOwnerByCode.set(poi.templateCode, arr);
  }

  const runItems: any[] = [];

  for (const item of items) {
    const owners = perOwnerByCode.get(item.template_code);

    if (owners && owners.length > 0) {
      // One fill run + one run item per qualifying owner — a 3-owner deal
      // gets 3 PFSs, each carrying its own ownership_entity_id through to
      // renderSbaPackageItem.
      for (const owner of owners) {
        const { data: fr, error: frErr } = await supabase
          .from("fill_runs")
          .insert([
            {
              deal_id: dealId,
              template_code: item.template_code,
              ownership_entity_id: owner.ownershipEntityId,
              status: "prepared",
              context: ctx,
            },
          ])
          .select("id")
          .limit(1);

        if (frErr) throw new Error(`fill_run_insert_failed(${item.template_code}/${owner.ownerName}): ${frErr.message}`);
        const fillRunId = fr?.[0]?.id as string | undefined;

        runItems.push({
          package_run_id: packageRunId,
          template_code: item.template_code,
          title: `${item.title} — ${owner.ownerName}`,
          sort_order: item.sort_order,
          required: item.required,
          fill_run_id: fillRunId ?? null,
          ownership_entity_id: owner.ownershipEntityId,
          status: "prepared",
        });
      }
    } else if (!isPerOwnerTemplateCode(item.template_code)) {
      const { data: fr, error: frErr } = await supabase
        .from("fill_runs")
        .insert([
          {
            deal_id: dealId,
            template_code: item.template_code,
            status: "prepared",
            context: ctx,
          },
        ])
        .select("id")
        .limit(1);

      if (frErr) throw new Error(`fill_run_insert_failed(${item.template_code}): ${frErr.message}`);
      const fillRunId = fr?.[0]?.id as string | undefined;

      runItems.push({
        package_run_id: packageRunId,
        template_code: item.template_code,
        title: item.title,
        sort_order: item.sort_order,
        required: item.required,
        fill_run_id: fillRunId ?? null,
        ownership_entity_id: null,
        status: "prepared",
      });
    }
    // else: a per-owner template with zero qualifying owners (e.g. SBA_912
    // where no owner's answers trigger it, or SBA_148L with no limited
    // guarantors) produces no run item — the form genuinely doesn't apply
    // to this deal. expandPerOwnerItems owns that determination.
  }

  const { error: riErr } = await supabase.from("sba_package_run_items").insert(runItems);
  if (riErr) throw new Error(`package_run_items_insert_failed: ${riErr.message}`);

  return { ok: true, packageRunId, itemCount: runItems.length };
}
