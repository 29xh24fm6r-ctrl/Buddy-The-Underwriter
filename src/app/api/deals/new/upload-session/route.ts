import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { signDealUpload } from "@/lib/uploads/signDealUpload";
import { buildUploadSession } from "@/lib/uploads/createUploadSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function randomUUID() {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
    ),
  ]);
}

async function createDealRow(args: { bankId: string; name: string }) {
  const sb = supabaseAdmin();
  const dealId = randomUUID();
  const baseInsertData: Record<string, any> = {
    id: dealId,
    bank_id: args.bankId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const optimisticInsertData: Record<string, any> = {
    ...baseInsertData,
    name: args.name,
    borrower_name: args.name,
    stage: "intake",
    entity_type: "Unknown",
    risk_score: 0,
  };

  type InsertRes = {
    data: { id: string; borrower_name?: string | null; created_at?: string | null } | null;
    error: { message: string } | null;
  };

  const insertOnce = async (payload: Record<string, any>): Promise<InsertRes> => {
    const res = await withTimeout<any>(
      sb.from("deals").insert(payload).select("id, borrower_name, created_at").single(),
      8_000,
      "insertDeal",
    );

    return {
      data: (res?.data ?? null) as any,
      error: (res?.error ?? null) as any,
    };
  };

  let deal: { id: string; borrower_name?: string | null; created_at?: string | null } | null = null;
  let error: { message: string } | null = null;

  {
    const res = await insertOnce(optimisticInsertData);
    deal = res.data;
    error = res.error;
  }

  if (error) {
    const msg = String(error?.message || "");
    const schemaMaybeMissing =
      msg.includes("column") &&
      (msg.includes("stage") || msg.includes("entity_type") || msg.includes("risk_score"));

    if (schemaMaybeMissing) {
      const fallbackPayload: Record<string, any> = {
        ...baseInsertData,
        name: args.name,
        borrower_name: args.name,
      };
      const res = await insertOnce(fallbackPayload);
      deal = res.data;
      error = res.error;
    }
  }

  if (error || !deal?.id) {
    throw new Error(error?.message || "failed_to_create_deal");
  }

  return { dealId: deal.id };
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || `upload_session_${Date.now()}`;
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "unauthorized", requestId },
        { status: 401 },
      );
    }

    const body = await req.json().catch(() => ({} as any));
    const dealName = String(body?.dealName || body?.name || "").trim();
    const files = Array.isArray(body?.files) ? body.files : [];

    if (!dealName) {
      return NextResponse.json(
        { ok: false, error: "missing_deal_name", requestId },
        { status: 400 },
      );
    }

    if (!files.length) {
      return NextResponse.json(
        { ok: false, error: "missing_files", requestId },
        { status: 400 },
      );
    }

    const bankId = await getCurrentBankId();
    const { dealId } = await createDealRow({ bankId, name: dealName });

    const normalizedFiles = files.map((f: any) => ({
      filename: String(f?.filename || ""),
      contentType: String(f?.contentType || f?.mimeType || ""),
      sizeBytes: Number(f?.sizeBytes || f?.size_bytes || 0),
      checklistKey: f?.checklistKey ?? f?.checklist_key ?? null,
    }));

    if (normalizedFiles.some((f: { filename: string; sizeBytes: number }) => !f.filename || !f.sizeBytes)) {
      return NextResponse.json(
        { ok: false, error: "invalid_file_payload", requestId },
        { status: 400 },
      );
    }

    const uploads = await buildUploadSession({
      req,
      dealId,
      files: normalizedFiles,
      requestId,
      signFile: ({ req: innerReq, dealId: innerDealId, file, requestId: innerRequestId }) =>
        signDealUpload({
          req: innerReq,
          dealId: innerDealId,
          filename: file.filename,
          mimeType: file.contentType || null,
          sizeBytes: file.sizeBytes,
          checklistKey: file.checklistKey,
          requestId: innerRequestId,
        }),
    });

    return NextResponse.json({
      ok: true,
      dealId,
      uploads,
      requestId,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "upload_session_failed",
        requestId,
      },
      { status: 500 },
    );
  }
}
