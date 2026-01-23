import { NextRequest, NextResponse } from "next/server";
import { handleCreateUploadSession } from "@/lib/uploads/createUploadSessionApi";
import { normalizeBootstrapPayload } from "@/lib/deals/bootstrapPayload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || `deal_bootstrap_${Date.now()}`;
  try {
    const body = await req.json().catch(() => ({} as any));
    const normalized = normalizeBootstrapPayload(body);
    if (!normalized.ok) {
      return NextResponse.json(
        { ok: false, error: normalized.error, requestId },
        { status: 400 },
      );
    }

    const proxyBody = {
      dealName: normalized.payload.dealName,
      source: "banker",
      files: normalized.payload.files.map((f) => ({
        name: f.filename,
        size: f.sizeBytes,
        mime: f.contentType || null,
      })),
    };

    const proxyReq = new NextRequest(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(proxyBody),
    });

    return await handleCreateUploadSession(proxyReq);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "bootstrap_failed", requestId },
      { status: 500 },
    );
  }
}
