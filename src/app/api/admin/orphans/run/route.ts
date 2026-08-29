import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { documentUploadBucket } from "@/lib/storage/documentBytes";
import { scanBucketPrefixToCache } from "@/lib/storage/orphanDetector";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MAX_OBJECTS = 25000;
const MAX_OBJECTS = 25000;
const PAGE_SIZE = 1000;
const MAX_RECONCILIATION_ROWS = 200000;
const MAX_FINDINGS_PER_KIND = 50000;

class RequestValidationError extends Error {}
class IncompleteScanError extends Error {}

function parseScanRequest(body: Record<string, unknown>) {
  const bucket = String(body.bucket ?? documentUploadBucket()).trim();
  const prefix = String(body.prefix ?? "deals/").trim();
  const rawMaxObjects = body.maxObjects ?? DEFAULT_MAX_OBJECTS;
  const maxObjects = Number(rawMaxObjects);

  if (
    !bucket ||
    bucket.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bucket)
  ) {
    throw new RequestValidationError("invalid_bucket");
  }

  if (
    !prefix ||
    prefix.length > 512 ||
    prefix.includes("..") ||
    !/^[A-Za-z0-9][A-Za-z0-9./-]*\/$/.test(prefix)
  ) {
    throw new RequestValidationError("invalid_prefix");
  }

  if (
    !Number.isInteger(maxObjects) ||
    maxObjects < 1 ||
    maxObjects > MAX_OBJECTS
  ) {
    throw new RequestValidationError("invalid_max_objects");
  }

  return { bucket, prefix, maxObjects };
}

async function readAllRows<T>(
  label: string,
  makeQuery: (from: number, to: number) => PromiseLike<any>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await makeQuery(from, from + PAGE_SIZE - 1);
    if (page.error) throw new Error(`${label} read failed: ${page.error.message}`);

    const data = (page.data || []) as T[];
    if (rows.length + data.length > MAX_RECONCILIATION_ROWS) {
      throw new IncompleteScanError(
        `${label} exceeded the reconciliation row limit`,
      );
    }

    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

async function insertFindings(
  sb: ReturnType<typeof supabaseAdmin>,
  rows: Record<string, unknown>[],
) {
  for (let offset = 0; offset < rows.length; offset += PAGE_SIZE) {
    const chunk = rows.slice(offset, offset + PAGE_SIZE);
    const result = await sb.from("orphan_findings").insert(chunk);
    if (result.error) {
      throw new Error(`orphan_findings insert failed: ${result.error.message}`);
    }
  }
}

export async function POST(req: Request) {
  const sb = supabaseAdmin();
  let runId: string | null = null;
  let startedAt: string | null = null;

  try {
    await requireSuperAdmin();

    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const { bucket, prefix, maxObjects } = parseScanRequest(body);
    startedAt = new Date().toISOString();

    const run = await sb
      .from("storage_scan_runs")
      .insert({
        bucket,
        prefix,
        status: "running",
        stats: { startedAt },
      })
      .select("id")
      .single();

    if (run.error || !run.data?.id) {
      return NextResponse.json(
        { ok: false, error: run.error?.message || "Failed to create scan run" },
        { status: 500 },
      );
    }

    runId = run.data.id as string;

    const { capped, seen } = await scanBucketPrefixToCache({
      sb,
      bucket,
      prefix,
      runId,
      maxObjects,
    });

    if (capped) {
      throw new IncompleteScanError(
        `scan reached maxObjects=${maxObjects}; no orphan findings were computed`,
      );
    }

    const storageCache = await readAllRows<{
      bucket: string;
      path: string;
      size_bytes: number | null;
      mime_type: string | null;
    }>("storage cache", (from, to) =>
      sb
        .from("storage_objects_cache")
        .select("bucket, path, size_bytes, mime_type")
        .eq("scan_run_id", runId!)
        .range(from, to),
    );

    // Prefixes are validated to exclude SQL LIKE wildcard characters.
    const docs = await readAllRows<{
      id: string;
      deal_id: string;
      storage_bucket: string;
      storage_path: string;
    }>("deal documents", (from, to) =>
      sb
        .from("deal_documents")
        .select("id, deal_id, storage_bucket, storage_path")
        .eq("storage_bucket", bucket)
        .like("storage_path", `${prefix}%`)
        .range(from, to),
    );

    const docSet = new Set(
      docs.map((doc) => `${doc.storage_bucket}|${doc.storage_path}`),
    );
    const cacheSet = new Set(
      storageCache.map((object) => `${object.bucket}|${object.path}`),
    );

    const storageOnlyRows = storageCache
      .filter((object) => !docSet.has(`${object.bucket}|${object.path}`))
      .map((object) => ({
        scan_run_id: runId,
        kind: "storage_only",
        deal_id: null,
        bucket: object.bucket,
        path: object.path,
        document_id: null,
        details: {
          reason: "Object exists in Storage but no deal_documents row",
          size_bytes: object.size_bytes,
          mime_type: object.mime_type,
        },
      }));

    const dbOnlyRows = docs
      .filter(
        (doc) =>
          !cacheSet.has(`${doc.storage_bucket}|${doc.storage_path}`),
      )
      .map((doc) => ({
        scan_run_id: runId,
        kind: "db_only",
        deal_id: doc.deal_id,
        bucket: doc.storage_bucket,
        path: doc.storage_path,
        document_id: doc.id,
        details: {
          reason:
            "deal_documents row exists but object not found in scanned Storage prefix",
        },
      }));

    if (
      storageOnlyRows.length > MAX_FINDINGS_PER_KIND ||
      dbOnlyRows.length > MAX_FINDINGS_PER_KIND
    ) {
      throw new IncompleteScanError(
        "orphan findings exceeded the safe persistence limit",
      );
    }

    await insertFindings(sb, storageOnlyRows);
    await insertFindings(sb, dbOnlyRows);

    const completedAt = new Date().toISOString();
    const completed = await sb
      .from("storage_scan_runs")
      .update({
        status: "success",
        error: null,
        stats: {
          startedAt,
          completedAt,
          capped: false,
          seen,
          storageOnly: storageOnlyRows.length,
          dbOnly: dbOnlyRows.length,
        },
      })
      .eq("id", runId)
      .select("id, status")
      .single();

    if (
      completed.error ||
      completed.data?.id !== runId ||
      completed.data?.status !== "success"
    ) {
      throw new Error(
        completed.error?.message || "scan completion was not persisted",
      );
    }

    return NextResponse.json({
      ok: true,
      runId,
      capped: false,
      seen,
      storageOnly: storageOnlyRows.length,
      dbOnly: dbOnlyRows.length,
    });
  } catch (err: unknown) {
    const message = String(err instanceof Error ? err.message : err);

    if (runId) {
      const failed = await sb
        .from("storage_scan_runs")
        .update({
          status: "failed",
          error: message,
          stats: {
            startedAt,
            failedAt: new Date().toISOString(),
          },
        })
        .eq("id", runId)
        .select("id, status")
        .single();

      if (
        failed.error ||
        failed.data?.id !== runId ||
        failed.data?.status !== "failed"
      ) {
        console.error("Failed to persist storage scan failure", {
          runId,
          error: failed.error?.message || "returned-row proof missing",
        });
      }
    }

    if (message === "unauthorized") {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
    if (message === "forbidden") {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    }
    if (err instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
    if (err instanceof IncompleteScanError) {
      return NextResponse.json({ ok: false, error: message }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
