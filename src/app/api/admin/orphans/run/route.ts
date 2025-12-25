import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { scanBucketPrefixToCache } from "@/lib/storage/orphanDetector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // SECURITY NOTE:
  // This is an admin route. If you already have requireRole/admin auth, add it here.
  // For now, keep it behind Clerk-protected admin UI / server calls.

  const body = await req.json().catch(() => ({}));
  const bucket = String(body.bucket || "deal-uploads");
  const prefix = String(body.prefix || "deals/");

  const sb = supabaseAdmin();

  const run = await sb
    .from("storage_scan_runs")
    .insert({
      bucket,
      prefix,
      status: "running",
      stats: { startedAt: new Date().toISOString() },
    })
    .select("id")
    .single();

  if (run.error || !run.data?.id) {
    return NextResponse.json(
      { ok: false, error: run.error?.message || "Failed to create scan run" },
      { status: 500 },
    );
  }

  const runId = run.data.id as string;

  try {
    const { capped, seen } = await scanBucketPrefixToCache({
      sb,
      bucket,
      prefix,
      runId,
      maxObjects: Number(body.maxObjects || 25000),
    });

    // Pure JS orphan compute fallback (no exec_sql dependency):
    // storage_only: cache rows without deal_documents match
    // db_only: deal_documents rows without cache match
    //
    // We do it in chunks to avoid memory spikes.

    // 1) storage_only
    const storageCache = await sb
      .from("storage_objects_cache")
      .select("bucket, path, size_bytes, mime_type")
      .eq("scan_run_id", runId)
      .limit(100000);

    if (storageCache.error) throw new Error(storageCache.error.message);

    // Build a set of canonical keys (bucket|path) from deal_documents for scanned prefix only
    const docs = await sb
      .from("deal_documents")
      .select("id, deal_id, storage_bucket, storage_path")
      .eq("storage_bucket", bucket)
      .like("storage_path", `${prefix}%`)
      .limit(200000);

    if (docs.error) throw new Error(docs.error.message);

    const docSet = new Set(
      (docs.data || []).map(
        (d: any) => `${d.storage_bucket}|${d.storage_path}`,
      ),
    );
    const cacheSet = new Set(
      (storageCache.data || []).map((c: any) => `${c.bucket}|${c.path}`),
    );

    const storageOnlyRows = (storageCache.data || [])
      .filter((c: any) => !docSet.has(`${c.bucket}|${c.path}`))
      .slice(0, 50000)
      .map((c: any) => ({
        scan_run_id: runId,
        kind: "storage_only",
        deal_id: null,
        bucket: c.bucket,
        path: c.path,
        document_id: null,
        details: {
          reason: "Object exists in Storage but no deal_documents row",
          size_bytes: c.size_bytes,
          mime_type: c.mime_type,
        },
      }));

    if (storageOnlyRows.length) {
      const ins = await sb.from("orphan_findings").insert(storageOnlyRows);
      if (ins.error) throw new Error(ins.error.message);
    }

    const dbOnlyRows = (docs.data || [])
      .filter(
        (d: any) => !cacheSet.has(`${d.storage_bucket}|${d.storage_path}`),
      )
      .slice(0, 50000)
      .map((d: any) => ({
        scan_run_id: runId,
        kind: "db_only",
        deal_id: d.deal_id,
        bucket: d.storage_bucket,
        path: d.storage_path,
        document_id: d.id,
        details: {
          reason:
            "deal_documents row exists but object not found in scanned Storage prefix",
        },
      }));

    if (dbOnlyRows.length) {
      const ins2 = await sb.from("orphan_findings").insert(dbOnlyRows);
      if (ins2.error) throw new Error(ins2.error.message);
    }

    await sb
      .from("storage_scan_runs")
      .update({
        status: "success",
        stats: {
          startedAt: new Date().toISOString(),
          capped,
          seen,
          storageOnly: storageOnlyRows.length,
          dbOnly: dbOnlyRows.length,
        },
      })
      .eq("id", runId);

    return NextResponse.json({
      ok: true,
      runId,
      capped,
      seen,
      storageOnly: storageOnlyRows.length,
      dbOnly: dbOnlyRows.length,
    });
  } catch (e: any) {
    await sb
      .from("storage_scan_runs")
      .update({ status: "failed", error: String(e?.message || e) })
      .eq("id", runId);
    return NextResponse.json(
      { ok: false, runId, error: String(e?.message || e) },
      { status: 500 },
    );
  }
}
