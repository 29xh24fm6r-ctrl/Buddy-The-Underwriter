import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();

const require = createRequire(import.meta.url);
const { persistRowWithStorageRollback } =
  require("../artifactPersistence") as typeof import("../artifactPersistence");

function client(args: {
  row?: Record<string, unknown> | null;
  updateError?: string;
  removeError?: string;
}) {
  const removals: Array<{ bucket: string; paths: string[] }> = [];
  const builder: any = {
    update() { return this; },
    eq() { return this; },
    select() { return this; },
    async maybeSingle() {
      return {
        data: args.row === undefined ? { id: "bundle-1", artifact_path: "new.pdf" } : args.row,
        error: args.updateError ? { message: args.updateError } : null,
      };
    },
  };
  const sb: any = {
    from() { return builder; },
    storage: {
      from(bucket: string) {
        return {
          async remove(paths: string[]) {
            removals.push({ bucket, paths });
            return {
              data: null,
              error: args.removeError ? { message: args.removeError } : null,
            };
          },
        };
      },
    },
  };
  return { sb: sb as SupabaseClient, removals };
}

const baseArgs = {
  table: "buddy_trident_bundles",
  filters: { id: "bundle-1", lease_token: "lease-1" },
  values: { artifact_path: "new.pdf" },
  expected: { artifact_path: "new.pdf" },
  uploaded: [
    { bucket: "trident-bundles", path: "deal/final/new.pdf" },
    { bucket: "trident-bundles", path: "deal/final/new.pdf" },
    { bucket: "deal-documents", path: "reviewed/new.pdf" },
  ],
  label: "Golden Trident artifact",
};

test("returns only after the filtered update returns the expected row", async () => {
  const { sb, removals } = client({});
  const row = await persistRowWithStorageRollback(sb, baseArgs);
  assert.equal(row.artifact_path, "new.pdf");
  assert.deepEqual(removals, []);
});

test("removes newly uploaded objects when the database update errors", async () => {
  const { sb, removals } = client({ updateError: "database unavailable" });
  await assert.rejects(
    persistRowWithStorageRollback(sb, baseArgs),
    /manifest write failed: database unavailable/,
  );
  assert.deepEqual(removals, [
    { bucket: "trident-bundles", paths: ["deal/final/new.pdf"] },
    { bucket: "deal-documents", paths: ["reviewed/new.pdf"] },
  ]);
});

test("treats an error-free zero-row update as lease loss and rolls storage back", async () => {
  const { sb, removals } = client({ row: null });
  await assert.rejects(
    persistRowWithStorageRollback(sb, baseArgs),
    /manifest write failed: row_not_returned/,
  );
  assert.equal(removals.length, 2);
});

test("rejects returned rows that do not prove the requested path", async () => {
  const { sb, removals } = client({ row: { id: "bundle-1", artifact_path: "old.pdf" } });
  await assert.rejects(
    persistRowWithStorageRollback(sb, baseArgs),
    /manifest write failed: returned_artifact_path_mismatch/,
  );
  assert.equal(removals.length, 2);
});

test("keeps the database failure primary while surfacing rollback failure", async () => {
  const { sb } = client({ updateError: "database unavailable", removeError: "storage unavailable" });
  await assert.rejects(
    persistRowWithStorageRollback(sb, baseArgs),
    /database unavailable; storage rollback failed: trident-bundles: storage unavailable \| deal-documents: storage unavailable/,
  );
});
