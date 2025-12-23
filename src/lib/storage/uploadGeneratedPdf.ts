import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Upload generated PDF to Supabase Storage
 * 
 * Bucket: generated-documents (private)
 * Path: deals/{dealId}/{docType}/{docId}.pdf
 */
export async function uploadGeneratedPdf(
  pdfBuffer: Buffer,
  dealId: string,
  docType: string,
  docId: string
): Promise<{ path: string; signedUrl: string }> {
  const path = `deals/${dealId}/${docType}/${docId}.pdf`;

  const supabase = supabaseAdmin();
  const { error: uploadError } = await supabase.storage
    .from("generated-documents")
    .upload(path, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true, // Allow re-generation
    });

  if (uploadError) {
    throw new Error(`Failed to upload PDF: ${uploadError.message}`);
  }

  // Generate signed URL (valid for 1 hour)
  const { data: signedData, error: signedError } = await supabase.storage
    .from("generated-documents")
    .createSignedUrl(path, 3600);

  if (signedError || !signedData) {
    throw new Error(`Failed to create signed URL: ${signedError?.message}`);
  }

  return {
    path,
    signedUrl: signedData.signedUrl,
  };
}

/**
 * Get signed URL for existing PDF
 */
export async function getSignedPdfUrl(path: string): Promise<string> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.storage
    .from("generated-documents")
    .createSignedUrl(path, 3600);

  if (error || !data) {
    throw new Error(`Failed to get signed URL: ${error?.message}`);
  }

  return data.signedUrl;
}
