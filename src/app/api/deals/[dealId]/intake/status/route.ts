import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { normalizeGoogleError } from "@/lib/google/errors";
import { ensureGcpAdcBootstrap } from "@/lib/gcpAdcBootstrap";
import { getGcsBucketName, getGcsClient } from "@/lib/storage/gcs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

type IntakeStatusResponse = {
  ok: boolean;
  dealId: string;
  uploads: { total: number; processed: number; pending: number };
  checklist: { required_total: number; received_required: number; missing_required: number };
  stage: string | null;
  lastError: {
    code: string;
    message: string;
    at: string;
    meta?: Record<string, unknown> | null;
  } | null;
  deps: { gcs: "ok" | "fail"; vertex: "ok" | "fail" };
};

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
    ),
  ]);
}

async function probeGcs(): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
  try {
    ensureGcpAdcBootstrap();
    const bucket = getGcsBucketName();
    const storage = getGcsClient();
    await withTimeout(storage.bucket(bucket).getMetadata(), 4000, "gcs_metadata");
    return { ok: true };
  } catch (e: any) {
    const normalized = normalizeGoogleError(e);
    return { ok: false, error: { code: normalized.code, message: normalized.message } };
  }
}

async function probeVertex(): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
  if (String(process.env.USE_GEMINI_OCR || "").toLowerCase() !== "true") {
    return { ok: false, error: { code: "VERTEX_DISABLED", message: "Gemini OCR disabled" } };
  }
  try {
    const { runVertexAdcSmokeTest } = await import("@/lib/gcpAdcBootstrap");
    await withTimeout(runVertexAdcSmokeTest(), 6000, "vertex_smoke");
    return { ok: true };
  } catch (e: any) {
    const normalized = normalizeGoogleError(e);
    return { ok: false, error: { code: normalized.code, message: normalized.message } };
  }
}

export async function GET(_req: Request, ctx: Ctx): Promise<NextResponse<IntakeStatusResponse>> {
  const { dealId } = await ctx.params;

  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      {
        ok: false,
        dealId,
        uploads: { total: 0, processed: 0, pending: 0 },
        checklist: { required_total: 0, received_required: 0, missing_required: 0 },
        stage: null,
        lastError: null,
        deps: { gcs: "fail", vertex: "fail" },
      },
      { status: 401 },
    );
  }

  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const { data: deal } = await sb
    .from("deals")
    .select("id, bank_id, stage, lifecycle_stage")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal || !deal.bank_id || deal.bank_id !== bankId) {
    return NextResponse.json(
      {
        ok: false,
        dealId,
        uploads: { total: 0, processed: 0, pending: 0 },
        checklist: { required_total: 0, received_required: 0, missing_required: 0 },
        stage: null,
        lastError: null,
        deps: { gcs: "fail", vertex: "fail" },
      },
      { status: 404 },
    );
  }

  const [{ count: borrowerUploads }, { count: dealDocs }] = await Promise.all([
    sb
      .from("borrower_uploads")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("bank_id", bankId),
    sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("bank_id", bankId),
  ]);

  const totalUploads = Math.max(borrowerUploads ?? 0, dealDocs ?? 0);
  const processedUploads = dealDocs ?? 0;
  const pendingUploads = Math.max(totalUploads - processedUploads, 0);

  const { data: checklistRows } = await sb
    .from("deal_checklist_items")
    .select("required, status")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId);

  const requiredRows = (checklistRows ?? []).filter((r: any) => !!r.required);
  const receivedRequired = requiredRows.filter((r: any) =>
    ["received", "satisfied"].includes(String(r.status ?? "")),
  ).length;
  const requiredTotal = requiredRows.length;
  const missingRequired = Math.max(requiredTotal - receivedRequired, 0);

  const { data: ledger } = await sb
    .from("deal_pipeline_ledger")
    .select("event_key, ui_message, meta, created_at")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(30);

  const errorEvent = (ledger ?? []).find((e: any) => {
    const key = String(e.event_key ?? "");
    return (
      key === "deal.intake.failed" ||
      key === "pipeline.intake.init_failed" ||
      key === "intake.init_failed" ||
      key.includes("failed")
    );
  });

  const lastError = errorEvent
    ? {
        code: String(errorEvent.meta?.error_code ?? "UNKNOWN"),
        message: String(errorEvent.meta?.error_message ?? errorEvent.ui_message ?? "Unknown error"),
        at: String(errorEvent.created_at),
        meta: (errorEvent.meta as Record<string, unknown>) ?? null,
      }
    : null;

  const [gcsProbe, vertexProbe] = await Promise.all([probeGcs(), probeVertex()]);

  return NextResponse.json({
    ok: true,
    dealId,
    uploads: { total: totalUploads, processed: processedUploads, pending: pendingUploads },
    checklist: {
      required_total: requiredTotal,
      received_required: receivedRequired,
      missing_required: missingRequired,
    },
    stage: (deal.stage as string) ?? deal.lifecycle_stage ?? null,
    lastError,
    deps: {
      gcs: gcsProbe.ok ? "ok" : "fail",
      vertex: vertexProbe.ok ? "ok" : "fail",
    },
  });
}
