// src/app/api/storage/signed-url/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseStorageClient } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

/**
 * GET /api/storage/signed-url?file_key=...&expiresIn=3600
 * Generate a short-lived signed URL for a file
 * 
 * Returns: { url, expires_in }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fileKey = searchParams.get('file_key');
    const expiresIn = parseInt(searchParams.get('expiresIn') || '3600'); // Default 1 hour

    if (!fileKey) {
      return json(400, { ok: false, error: 'Missing file_key' });
    }

    const storage = getSupabaseStorageClient();
    
    if (!storage) {
      // Fallback: Return local file URL (development)
      return await handleLocalSignedUrl(fileKey);
    }

    // Production: Generate Supabase signed URL
    const { data, error } = await storage
      .from('deal_uploads')
      .createSignedUrl(fileKey, expiresIn);

    if (error) {
      console.error('[storage/signed-url] Supabase error:', error);
      return json(404, { ok: false, error: 'File not found' });
    }

    return json(200, {
      ok: true,
      url: data.signedUrl,
      expires_in: expiresIn,
    });
  } catch (e: any) {
    console.error('[storage/signed-url] error:', e);
    return json(500, { ok: false, error: e.message });
  }
}

/**
 * Fallback: Local file URL (development)
 */
async function handleLocalSignedUrl(fileKey: string) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  
  const filePath = path.join(process.cwd(), '.data', 'uploads', fileKey);
  
  try {
    await fs.access(filePath);
    
    // Return a URL that the existing /api/files/signed-url route can handle
    // Or create a simple endpoint
    const url = `/api/files/local?path=${encodeURIComponent(fileKey)}`;
    
    return json(200, {
      ok: true,
      url,
      expires_in: 3600,
      storage: 'local',
    });
  } catch {
    return json(404, { ok: false, error: 'File not found' });
  }
}
