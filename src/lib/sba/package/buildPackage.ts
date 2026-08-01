import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePackageItems } from "./resolvePackage";
import { buildSbaPackageContext } from "./context";
import { isPerOwnerTemplateCode, expandPerOwnerItems } from "./perOwnerExpansion";

/**
 * Creates an `sba_package_runs` row plus its `sba_package_run_items`,
 * expanding per-owner forms (413, 912, 4506-C, 148, 148L) into one item
 * per (template_code, owner) via expandPerOwnerItems.
 *
 * `fill_run_id` is intentionally left null (audit 2026-08-01).
 *
 * This function previously inserted a row into `public.fill_runs` per
 * item and stored the returned id on the run item. That table has never
 * existed in this database: 20251218000013_sba_package_builder.sql
 * created `sba_package_run_items.fill_run_id` as a bare `uuid null` with
 * NO foreign key and never created the referenced table, no later
 * migration did either, and it appears in neither schema-reap batch
 * (20260729030000 / 20260729040000) — it was never dropped because it was
 * never created.
 *
 * Every call therefore threw `relation "public.fill_runs" does not exist`
 * on the first item, before reaching any renderer, which is why
 * prepareSbaPackage has never successfully run in production.
 *
 * Nothing consumes fill_run_id — assembleTenTabPackage.ts selects
 * `output_storage_path`, and renderSbaPackageItem (sbaFormDispatch.ts) is
 * the live render path, superseding the legacy generic fill-engine the
 * column was designed for. So the phantom insert is removed rather than
 * the table manufactured. The column itself is left in place (nullable)
 * for schema compatibility.
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
      // One run item per qualifying owner — a 3-owner deal gets 3 PFSs.
      for (const owner of owners) {
        runItems.push({
          package_run_id: packageRunId,
          template_code: item.template_code,
          title: `${item.title} — ${owner.ownerName}`,
          sort_order: item.sort_order,
          required: item.required,
          fill_run_id: null,
          ownership_entity_id: owner.ownershipEntityId,
          status: "prepared",
        });
      }
    } else if (!isPerOwnerTemplateCode(item.template_code)) {
      runItems.push({
        package_run_id: packageRunId,
        template_code: item.template_code,
        title: item.title,
        sort_order: item.sort_order,
        required: item.required,
        fill_run_id: null,
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
