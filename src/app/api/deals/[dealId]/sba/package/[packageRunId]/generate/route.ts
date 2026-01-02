import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { generatePdfForFillRun } from "@/lib/forms/pdfFill/generatePdfForFillRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string; packageRunId: string }> },
) {
  try {
    const { dealId, packageRunId } = await ctx.params;
    const body = await req.json().catch(() => ({}) as any);
    const onlyItemId = (body?.onlyItemId as string | undefined) ?? undefined;

    const supabase = getSupabaseServerClient();

    const { data: items, error: iErr } = await supabase
      .from("sba_package_run_items")
      .select("id,template_code,title,fill_run_id,required,status")
      .eq("package_run_id", packageRunId);

    if (iErr) throw new Error(`package_items_load_failed: ${iErr.message}`);

    const list = (items ?? []).filter(
      (it: any) => !onlyItemId || it.id === onlyItemId,
    );

    const results: any[] = [];

    for (const it of list) {
      const fillRunId = it.fill_run_id as string | null;

      if (!fillRunId) {
        await supabase
          .from("sba_package_run_items")
          .update({ status: "failed", error: "Missing fill_run_id" })
          .eq("id", it.id);
        results.push({
          itemId: it.id,
          ok: false,
          error: "Missing fill_run_id",
        });
        continue;
      }

      try {
        const out = await generatePdfForFillRun({
          supabase,
          dealId,
          fillRunId,
        });

        await supabase
          .from("sba_package_run_items")
          .update({
            status: "generated",
            output_storage_path: out.storagePath ?? null,
            output_file_name: out.fileName ?? `${it.template_code}.pdf`,
            error: null,
          })
          .eq("id", it.id);

        results.push({ itemId: it.id, ok: true, ...out });
      } catch (e: any) {
        await supabase
          .from("sba_package_run_items")
          .update({ status: "failed", error: e?.message || "generate_failed" })
          .eq("id", it.id);
        results.push({
          itemId: it.id,
          ok: false,
          error: e?.message || "generate_failed",
        });
      }
    }

    const anyFailed = results.some((r) => !r.ok);
    await supabase
      .from("sba_package_runs")
      .update({ status: anyFailed ? "failed" : "generated" })
      .eq("id", packageRunId);

    return NextResponse.json({ ok: true, packageRunId, results });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "sba_package_generate_failed" },
      { status: 500 },
    );
  }
}
