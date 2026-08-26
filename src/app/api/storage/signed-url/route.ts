// src/app/api/storage/signed-url/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseStorageClient } from "@/lib/supabase/client";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";
import {
  clampSignedUrlTtl,
  parseDealScopedStorageKey,
} from "@/lib/storage/legacyRouteAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

/**
 * GET /api/storage/signed-url?file_key=...&expiresIn=600
 * Generate a short-lived signed URL for an authenticated user's deal file.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parsedKey = parseDealScopedStorageKey(searchParams.get("file_key") || "");

    if (!parsedKey) {
      return json(400, { ok: false, error: "invalid_file_key" });
    }

    try {
      await assertDealAccess(parsedKey.dealId);
    } catch (error) {
      const accessResponse = accessErrorToResponse(error);
      if (accessResponse) return accessResponse;
      return json(500, { ok: false, error: "access_check_failed" });
    }

    const expiresIn = clampSignedUrlTtl(
      searchParams.get("expiresIn") || searchParams.get("expires_in"),
    );
    const storage = getSupabaseStorageClient();

    if (!storage) {
      if (process.env.NODE_ENV === "production") {
        return json(503, { ok: false, error: "storage_unavailable" });
      }
      return await handleLocalSignedUrl(parsedKey.normalizedKey, expiresIn);
    }

    const { data, error } = await storage
      .from("deal_uploads")
      .createSignedUrl(parsedKey.normalizedKey, expiresIn);

    if (error || !data?.signedUrl) {
      console.error("[storage/signed-url] Supabase signing failed");
      return json(404, { ok: false, error: "file_not_found" });
    }

    return json(200, {
      ok: true,
      url: data.signedUrl,
      expires_in: expiresIn,
    });
  } catch (error: unknown) {
    console.error("[storage/signed-url] unexpected failure", error);
    return json(500, { ok: false, error: "signed_url_failed" });
  }
}

async function handleLocalSignedUrl(fileKey: string, expiresIn: number) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const uploadsRoot = path.resolve(process.cwd(), ".data", "uploads");
  const filePath = path.resolve(uploadsRoot, fileKey);
  if (!filePath.startsWith(uploadsRoot + path.sep)) {
    return json(400, { ok: false, error: "invalid_file_key" });
  }

  try {
    await fs.access(filePath);
    return json(200, {
      ok: true,
      url: `/api/files/local?path=${encodeURIComponent(fileKey)}`,
      expires_in: expiresIn,
      storage: "local",
    });
  } catch {
    return json(404, { ok: false, error: "file_not_found" });
  }
}
