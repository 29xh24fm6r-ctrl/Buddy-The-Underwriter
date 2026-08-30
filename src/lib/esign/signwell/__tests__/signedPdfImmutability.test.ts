import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { persistImmutableSignedPdf } from "@/lib/esign/signwell/service";

function stored(bytes: Buffer) {
  return {
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
}

function storageClient(args: {
  uploadError?: Record<string, unknown> | null;
  storedBytes?: Buffer | null;
}) {
  const uploads: Array<{ path: string; bytes: Buffer; opts: Record<string, unknown> }> = [];
  const downloads: string[] = [];
  return {
    uploads,
    downloads,
    client: {
      storage: {
        from: (bucket: string) => {
          assert.equal(bucket, "signed-documents");
          return {
            upload: async (path: string, bytes: Buffer, opts: Record<string, unknown>) => {
              uploads.push({ path, bytes: Buffer.from(bytes), opts });
              return { error: args.uploadError ?? null };
            },
            download: async (path: string) => {
              downloads.push(path);
              return args.storedBytes
                ? { data: stored(args.storedBytes), error: null }
                : { data: null, error: { message: "not_found" } };
            },
          };
        },
      },
    },
  };
}

test("persistImmutableSignedPdf creates once and proves the stored bytes", async () => {
  const pdf = Buffer.from("%PDF-1.7 immutable signature");
  const fake = storageClient({ storedBytes: pdf });

  const result = await persistImmutableSignedPdf(fake.client as any, "signed-documents/d1/f1/o1/doc.pdf", pdf);

  assert.deepEqual(result, {
    ok: true,
    sha256: createHash("sha256").update(pdf).digest("hex"),
    size: pdf.byteLength,
    reused: false,
  });
  assert.equal(fake.uploads.length, 1);
  assert.deepEqual(fake.uploads[0].opts, {
    contentType: "application/pdf",
    upsert: false,
  });
  assert.equal(fake.downloads.length, 1);
});

test("persistImmutableSignedPdf reuses a duplicate object only after exact byte proof", async () => {
  const pdf = Buffer.from("%PDF-1.7 same signed bytes");
  const fake = storageClient({
    uploadError: { statusCode: "409", message: "The resource already exists" },
    storedBytes: pdf,
  });

  const result = await persistImmutableSignedPdf(fake.client as any, "signed.pdf", pdf);

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.reused, true);
  assert.deepEqual(fake.downloads, ["signed.pdf"]);
});

test("persistImmutableSignedPdf rejects an existing object with different bytes", async () => {
  const pdf = Buffer.from("%PDF-1.7 canonical signed bytes");
  const fake = storageClient({
    uploadError: { statusCode: 409, message: "Duplicate" },
    storedBytes: Buffer.from("%PDF-1.7 overwritten bytes"),
  });

  const result = await persistImmutableSignedPdf(fake.client as any, "signed.pdf", pdf);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.detail, /^signed_pdf_integrity_mismatch:/);
    assert.match(result.detail, /expected_sha256=/);
    assert.match(result.detail, /stored_sha256=/);
  }
});

test("persistImmutableSignedPdf does not reinterpret storage outages as duplicate success", async () => {
  const pdf = Buffer.from("%PDF-1.7 signed");
  const fake = storageClient({
    uploadError: { statusCode: 503, message: "storage unavailable" },
    storedBytes: pdf,
  });

  const result = await persistImmutableSignedPdf(fake.client as any, "signed.pdf", pdf);

  assert.deepEqual(result, {
    ok: false,
    detail: "signed_pdf_create_failed:storage unavailable",
  });
  assert.deepEqual(fake.downloads, []);
});

test("persistImmutableSignedPdf requires a readable authoritative object after upload", async () => {
  const pdf = Buffer.from("%PDF-1.7 signed");
  const fake = storageClient({ storedBytes: null });

  const result = await persistImmutableSignedPdf(fake.client as any, "signed.pdf", pdf);

  assert.deepEqual(result, {
    ok: false,
    detail: "signed_pdf_verification_download_failed:not_found",
  });
});
