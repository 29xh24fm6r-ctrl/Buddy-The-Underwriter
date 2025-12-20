import type { SupabaseClient } from "@supabase/supabase-js";

export type PackageItem = {
  template_code: string;
  title: string;
  sort_order: number;
  required: boolean;
  applies_when: any;
};

function applies(item: PackageItem, ctx: { product: "7a" | "504" | "express" }) {
  const rule = item.applies_when;
  if (!rule || typeof rule !== "object") return true;
  if (rule.product && rule.product !== ctx.product) return false;
  return true;
}

export async function resolvePackageItems(opts: {
  supabase: SupabaseClient;
  packageTemplateCode: string;
  product: "7a" | "504" | "express";
}): Promise<PackageItem[]> {
  const { supabase, packageTemplateCode, product } = opts;

  const { data: pkg, error: pErr } = await supabase
    .from("sba_package_templates")
    .select("id")
    .eq("code", packageTemplateCode)
    .limit(1);

  if (pErr) throw new Error(`package_template_lookup_failed: ${pErr.message}`);
  const pkgId = pkg?.[0]?.id as string | undefined;
  if (!pkgId) throw new Error(`package_template_not_found: ${packageTemplateCode}`);

  const { data: items, error: iErr } = await supabase
    .from("sba_package_items")
    .select("template_code,title,sort_order,required,applies_when")
    .eq("package_template_id", pkgId)
    .order("sort_order", { ascending: true });

  if (iErr) throw new Error(`package_items_lookup_failed: ${iErr.message}`);

  return (items ?? []).filter((it: any) =>
    applies(
      {
        template_code: it.template_code,
        title: it.title,
        sort_order: it.sort_order,
        required: it.required,
        applies_when: it.applies_when,
      },
      { product }
    )
  );
}
