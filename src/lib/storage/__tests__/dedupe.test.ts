import test from "node:test";
import assert from "node:assert/strict";

import { findExistingDocBySha } from "@/lib/storage/dedupeCore";

test("findExistingDocBySha returns latest match", async () => {
  const sb: any = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "doc-123",
                    storage_bucket: "bucket",
                    storage_path: "path/to/file.pdf",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  };

  const result = await findExistingDocBySha({
    sb,
    dealId: "deal-1",
    sha256: "abc",
  });

  assert.deepEqual(result, {
    id: "doc-123",
    storage_bucket: "bucket",
    storage_path: "path/to/file.pdf",
  });
});
