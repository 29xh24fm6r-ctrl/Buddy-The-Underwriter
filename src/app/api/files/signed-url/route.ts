import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get("file_id");

    if (!fileId) {
      return NextResponse.json({ error: "file_id parameter required" }, { status: 400 });
    }

    // For now, we'll serve files directly from the filesystem
    // In production, you'd want to add authentication and proper security
    const baseDir = "/tmp/buddy_uploads";

    // Find the file by searching directories
    let filePath: string | null = null;
    let mimeType: string = "application/octet-stream";

    try {
      const dealDirs = await fs.readdir(baseDir);
      for (const dealId of dealDirs) {
        const dealPath = path.join(baseDir, dealId);
        try {
          const files = await fs.readdir(dealPath);
          const file = files.find(f => f.startsWith(fileId + "__"));
          if (file) {
            filePath = path.join(dealPath, file);
            // Determine mime type from file extension
            if (file.toLowerCase().endsWith('.pdf')) {
              mimeType = 'application/pdf';
            } else if (file.toLowerCase().match(/\.(jpg|jpeg|png|gif)$/)) {
              mimeType = 'image/' + path.extname(file).slice(1);
            }
            break;
          }
        } catch (e) {
          // Directory might not exist, continue
        }
      }
    } catch (e) {
      // Base directory might not exist
    }

    if (!filePath) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Read and return the file
    const fileBuffer = await fs.readFile(filePath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'private, max-age=3600', // Cache for 1 hour
      },
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}