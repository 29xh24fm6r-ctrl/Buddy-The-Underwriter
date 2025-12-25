// src/app/api/files/local/route.ts
// Serve local files (development fallback)
import "server-only";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const relativePath = searchParams.get("path");

    if (!relativePath) {
      return new NextResponse("Missing path", { status: 400 });
    }

    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const filePath = path.join(process.cwd(), ".data", "uploads", relativePath);

    // Security: Ensure path is within .data/uploads
    const normalizedPath = path.normalize(filePath);
    const baseDir = path.join(process.cwd(), ".data", "uploads");

    if (!normalizedPath.startsWith(baseDir)) {
      return new NextResponse("Invalid path", { status: 403 });
    }

    const fileBuffer = await fs.readFile(normalizedPath);

    // Determine content type from extension
    const ext = path.extname(relativePath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      ".pdf": "application/pdf",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".txt": "text/plain",
      ".json": "application/json",
      ".csv": "text/csv",
      ".xlsx":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };

    const contentType = contentTypeMap[ext] || "application/octet-stream";

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e: any) {
    console.error("[files/local] error:", e);
    return new NextResponse("File not found", { status: 404 });
  }
}
