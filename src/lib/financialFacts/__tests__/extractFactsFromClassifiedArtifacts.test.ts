import test from "node:test";
import assert from "node:assert/strict";

// ── Pipeline integrity guard verification ─────────────────────────────

test("extractFactsFromClassifiedArtifacts includes isExtractionErrorPayload guard", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractFactsFromClassifiedArtifacts.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("isExtractionErrorPayload"),
    "extractFactsFromClassifiedArtifacts.ts must filter out error payload artifacts",
  );
});

test("extraction_json is included in the artifact query select", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractFactsFromClassifiedArtifacts.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("extraction_json"),
    "Artifact query must select extraction_json for error payload filtering",
  );
});
