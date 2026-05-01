import { Storage } from '@google-cloud/storage';

let _storage: Storage | null = null;

function getStorage(): Storage {
  if (!_storage) _storage = new Storage();
  return _storage;
}

/** Parse `gs://bucket/path/to/object.pdf` into bucket + object name. */
function parseGcsPath(gcsPath: string): { bucket: string; object: string } {
  const m = gcsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) {
    throw new Error(`malformed gcs_path: ${gcsPath}`);
  }
  return { bucket: m[1]!, object: m[2]! };
}

export async function downloadPdfFromGcs(gcsPath: string): Promise<Buffer> {
  const { bucket, object } = parseGcsPath(gcsPath);
  const file = getStorage().bucket(bucket).file(object);
  const [contents] = await file.download();
  return Buffer.from(contents);
}
