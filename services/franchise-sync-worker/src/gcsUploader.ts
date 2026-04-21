/**
 * Content-addressable GCS uploader for franchise FDD PDFs.
 *
 * Opt-in: if GCS_BUCKET is unset, upload() returns a "skipped" result and
 * the caller proceeds with gcs_path=null. This lets the scraper run (and
 * prove end-to-end scrape + hash + metadata persistence) before bucket
 * infrastructure is formally chosen/provisioned.
 *
 * When GCS_BUCKET IS set, Cloud Run uses ADC via the attached service
 * account — no explicit credentials needed in the code.
 */

import { Storage } from '@google-cloud/storage';
import { createHash } from 'node:crypto';

const FDD_PREFIX = 'franchise-fdds';

let _storage: Storage | null = null;

function getStorage(): Storage {
  if (!_storage) _storage = new Storage();
  return _storage;
}

export interface UploadResult {
  sha256: string;
  gcsPath: string | null;        // null when skipped (no bucket configured)
  status: 'uploaded' | 'already_exists' | 'skipped' | 'failed';
  error?: string;
}

export async function uploadFddToGcs(
  pdfBuffer: Buffer,
  metadata: {
    brandName: string;
    filingYear: number;
    filingState: string;
    fileNumber?: string;
  }
): Promise<UploadResult> {
  const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');
  const bucketName = process.env.GCS_BUCKET;

  if (!bucketName) {
    return {
      sha256,
      gcsPath: null,
      status: 'skipped',
    };
  }

  const objectPath = `${FDD_PREFIX}/${sha256}.pdf`;
  const gcsPath = `gs://${bucketName}/${objectPath}`;

  try {
    const bucket = getStorage().bucket(bucketName);
    const file = bucket.file(objectPath);

    const [exists] = await file.exists();
    if (exists) {
      return { sha256, gcsPath, status: 'already_exists' };
    }

    await file.save(pdfBuffer, {
      contentType: 'application/pdf',
      metadata: {
        metadata: {
          brand_name: metadata.brandName,
          filing_year: String(metadata.filingYear),
          filing_state: metadata.filingState,
          file_number: metadata.fileNumber ?? '',
          source: 'wi_dfi',
        },
      },
    });
    return { sha256, gcsPath, status: 'uploaded' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sha256, gcsPath: null, status: 'failed', error: msg };
  }
}

/** Quick heuristic: count /Type /Page occurrences in a PDF buffer. Returns
 *  null if the count looks implausible (parse failure). */
export function estimatePageCount(pdfBuffer: Buffer): number | null {
  const s = pdfBuffer.toString('latin1');
  const matches = s.match(/\/Type\s*\/Page[^s]/g);
  const n = matches?.length ?? 0;
  return n > 0 && n < 10_000 ? n : null;
}
