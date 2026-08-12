import { NextResponse } from "next/server";
import {
  MAX_DOCUMENT_BYTES,
  bearerMatches,
  parseProviderRequest,
  readProviderAdmission,
  sha256,
  validateSubmission,
} from "@/lib/buddyLosProvider/contract";
import { processDocument } from "@/lib/buddyLosProvider/processDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const admission = readProviderAdmission();
  if (!admission.enabled) return json({ error: "provider_unavailable" }, 503);
  if (!bearerMatches(request.headers.get("authorization"), admission.config.apiKey)) {
    return json({ error: "unauthorized" }, 401);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_DOCUMENT_BYTES + 1024 * 1024) {
    return json({ error: "payload_too_large" }, 413);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    return json({ error: "multipart_required" }, 415);
  }

  try {
    const form = await request.formData();
    const rawRequest = form.get("request");
    const file = form.get("file");
    if (typeof rawRequest !== "string" || !(file instanceof File)) {
      return json({ error: "invalid_submission" }, 400);
    }

    const providerRequest = parseProviderRequest(rawRequest);
    validateSubmission({
      request: providerRequest,
      idempotencyKey: request.headers.get("idempotency-key"),
      fileMediaType: file.type,
      fileSize: file.size,
      entitledOrganizationIds: admission.config.entitledOrganizationIds,
    });
    const bytes = Buffer.from(await file.arrayBuffer());
    if (sha256(bytes) !== providerRequest.sha256) return json({ error: "document_hash_mismatch" }, 422);

    const result = await processDocument({
      request: providerRequest,
      bytes,
      providerName: admission.config.providerName,
    });
    return json(result, 200);
  } catch (error) {
    const code = error instanceof Error ? error.message : "processing_failed";
    if (code === "organization_not_entitled") return json({ error: code }, 403);
    if (code === "unsupported_media_type") return json({ error: code }, 415);
    if (code === "invalid_document_size") return json({ error: code }, 413);
    if (code.startsWith("invalid_") || code === "unsupported_contract_version" || code === "media_type_mismatch") {
      return json({ error: code }, 400);
    }
    console.error("[buddy-los-provider] processing failed", { code, error });
    return json({ error: "processing_failed" }, 500);
  }
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
