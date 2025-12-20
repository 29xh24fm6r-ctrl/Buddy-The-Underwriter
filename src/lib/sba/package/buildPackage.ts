import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePackageItems } from "./resolvePackage";
import { buildSbaPackageContext } from "./context";

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

  const runItems: any[] = [];

  for (const item of items) {
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
      status: "prepared",
    });
  }

  const { error: riErr } = await supabase.from("sba_package_run_items").insert(runItems);
  if (riErr) throw new Error(`package_run_items_insert_failed: ${riErr.message}`);

  return { ok: true, packageRunId, itemCount: items.length };
}
