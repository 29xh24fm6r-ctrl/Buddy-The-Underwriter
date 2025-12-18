// src/app/api/storage/upload/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseStorageClient } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

/**
 * POST /api/storage/upload
 * Upload file to Supabase Storage
 * 
 * Body: multipart/form-data
 *   - file: File
 *   - dealId: string
 *   - applicationId: string (optional)
 *   - filename: string (optional, uses file.name if not provided)
 * 
 * Returns: { file_key, mime_type, size, url }
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    
    const file = formData.get('file') as File | null;
    const dealId = formData.get('dealId') as string | null;
    const applicationId = formData.get('applicationId') as string | null;
    let filename = formData.get('filename') as string | null;

    if (!file) {
      return json(400, { ok: false, error: 'Missing file' });
    }

    if (!dealId) {
      return json(400, { ok: false, error: 'Missing dealId' });
    }

    if (!filename) {
      filename = file.name;
    }

    const storage = getSupabaseStorageClient();
    
    if (!storage) {
      // Fallback: Save to local file system (development)
      return await handleLocalUpload(file, dealId, applicationId, filename);
    }

    // Production: Upload to Supabase Storage
    const timestamp = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const basePath = applicationId 
      ? `${dealId}/${applicationId}`
      : `${dealId}/uploads`;
    
    const fileKey = `${basePath}/${timestamp}_${safeName}`;

    // Convert File to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage
    const { data, error } = await storage
      .from('deal_uploads')
      .upload(fileKey, buffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (error) {
      console.error('[storage/upload] Supabase error:', error);
      return json(500, { ok: false, error: error.message });
    }

    return json(200, {
      ok: true,
      file_key: data.path,
      mime_type: file.type,
      size: file.size,
      bucket: 'deal_uploads',
    });
  } catch (e: any) {
    console.error('[storage/upload] error:', e);
    return json(500, { ok: false, error: e.message });
  }
}

/**
 * Fallback: Local file system upload (development)
 */
async function handleLocalUpload(
  file: File,
  dealId: string,
  applicationId: string | null,
  filename: string
) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  
  const baseDir = applicationId
    ? path.join(process.cwd(), '.data', 'uploads', dealId, applicationId)
    : path.join(process.cwd(), '.data', 'uploads', dealId);
  
  await fs.mkdir(baseDir, { recursive: true });
  
  const timestamp = Date.now();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storedName = `${timestamp}_${safeName}`;
  const filePath = path.join(baseDir, storedName);
  
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  await fs.writeFile(filePath, buffer);
  
  const fileKey = applicationId
    ? `${dealId}/${applicationId}/${storedName}`
    : `${dealId}/uploads/${storedName}`;
  
  return json(200, {
    ok: true,
    file_key: fileKey,
    mime_type: file.type,
    size: file.size,
    storage: 'local',
    path: filePath,
  });
}
