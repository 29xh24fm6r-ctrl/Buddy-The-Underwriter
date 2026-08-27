import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const snapshot =
  require("../tridentInputSnapshot") as typeof import("../tridentInputSnapshot");
const { TRIDENT_SNAPSHOT_VERSION, TridentSnapshotSchemaChanged, hashTridentManifest } = snapshot;

/**
 * Production evidence, 916 Golden Trident runs over twelve days, zero
 * successes. Two of the failure classes were undiagnosable by construction,
 * and these tests pin the properties that make them readable.
 */

// ── The largest failure cluster in the factory's history ────────────────────
//
// 840 preview runs recorded exactly "SBA package generation failed: Assumption
// validation failed" in generation_error. The orchestrator knew WHICH
// preconditions failed — it returns them in `blockers` — but the throw site
// interpolated only the headline, so the reason was discarded at the moment it
// was needed. Whatever caused those 840 failures cannot now be recovered from
// data.
test("[diagnosability] a validation failure records which preconditions failed", () => {
  const src = require("node:fs").readFileSync(
    "src/lib/brokerage/trident/generateTridentBundle.ts",
    "utf8",
  ) as string;

  const throwSite = src.slice(
    src.indexOf("if (!sbaResult.ok)"),
    src.indexOf("if (!sbaResult.ok)") + 900,
  );
  assert.match(
    throwSite,
    /blockers/,
    "the SBA failure path must carry sbaResult.blockers into the recorded error",
  );
  // The bare form is what produced 840 unreadable rows.
  assert.doesNotMatch(
    throwSite,
    /throw new Error\(`SBA package generation failed: \$\{sbaResult\.error\}`\);/,
    "the headline-only throw discards the blocker list",
  );
});

// ── A deploy is not a borrower edit ─────────────────────────────────────────
//
// hashTridentManifest digests `sources` for v5/v6 and the whole manifest for
// earlier shapes, so hashes from different schema generations are incomparable
// rather than merely unequal. Production ran six generations in twelve days;
// when a deploy landed mid-run, the workflow step compared its own digest
// against one the previous schema produced, failed after three retries, and
// reported `input_snapshot_changed` — which reads as "the borrower edited the
// deal". Five runs died that way, none with a changed_sources list, because
// there was no drift to list.
test("[schema] a superseded manifest version is reported as a schema change", async () => {
  let thrown: unknown;
  try {
    await snapshot.assertTridentInputSnapshot({
      sb: {} as never, // never reached — the version check precedes any read
      dealId: "deal-1",
      expectedHash: "whatever",
      expectedManifest: { version: 4, someOldShape: true },
    });
  } catch (error) {
    thrown = error;
  }
  assert.ok(
    thrown instanceof TridentSnapshotSchemaChanged,
    "a version mismatch must be its own error type, not generic input drift",
  );
  const message = (thrown as Error).message;
  assert.match(message, /snapshot_schema_superseded/);
  assert.match(message, /v4/, "must name the admitted schema generation");
  assert.match(message, new RegExp(`v${TRIDENT_SNAPSHOT_VERSION}`), "must name the current one");
  assert.match(
    message,
    /inputs did not change/i,
    "must say plainly that this is not borrower drift",
  );
  assert.doesNotMatch(
    message,
    /^input_snapshot_changed/,
    "must not masquerade as the drift error",
  );
});

test("[schema] the version check runs before any database read", async () => {
  // Proven by the sb stub: any property access on it throws. If the version
  // check did not short-circuit, computeTridentInputSnapshot would touch it.
  const exploding = new Proxy(
    {},
    { get() { throw new Error("database was read before the schema check"); } },
  ) as never;
  await assert.rejects(
    () => snapshot.assertTridentInputSnapshot({
      sb: exploding,
      dealId: "deal-1",
      expectedHash: "h",
      expectedManifest: { version: TRIDENT_SNAPSHOT_VERSION - 1 },
    }),
    TridentSnapshotSchemaChanged,
  );
});

test("[schema] a current-generation manifest still proceeds to the hash comparison", async () => {
  // The check must not swallow real drift detection.
  const exploding = new Proxy(
    {},
    { get() { throw new Error("reached the database"); } },
  ) as never;
  await assert.rejects(
    () => snapshot.assertTridentInputSnapshot({
      sb: exploding,
      dealId: "deal-1",
      expectedHash: "h",
      expectedManifest: { version: TRIDENT_SNAPSHOT_VERSION },
    }),
    /reached the database/,
    "a matching schema version must fall through to the real snapshot read",
  );
});

test("[schema] the emitted manifest carries the version the verifier expects", () => {
  // If these drift apart, every run self-invalidates on its first step.
  const src = require("node:fs").readFileSync(
    "src/lib/brokerage/trident/tridentInputSnapshot.ts",
    "utf8",
  ) as string;
  assert.match(
    src,
    /version:\s*TRIDENT_SNAPSHOT_VERSION/,
    "computeTridentInputSnapshot must stamp the shared constant, not a literal",
  );
  // And the hash domain must recognise that version.
  const digested = hashTridentManifest({
    version: TRIDENT_SNAPSHOT_VERSION,
    sources: { deal: { id: "d1" } },
    governedEvidenceAtAdmission: { volatile: Math.random() },
    derivedAtAdmission: { alsoVolatile: Math.random() },
  });
  const sameSourcesDifferentEvidence = hashTridentManifest({
    version: TRIDENT_SNAPSHOT_VERSION,
    sources: { deal: { id: "d1" } },
    governedEvidenceAtAdmission: { volatile: Math.random() },
    derivedAtAdmission: { alsoVolatile: Math.random() },
  });
  assert.equal(
    digested,
    sameSourcesDifferentEvidence,
    "the current version must digest only `sources`; if it digests the whole " +
      "manifest, asynchronously-governed evidence invalidates admitted runs",
  );
});
