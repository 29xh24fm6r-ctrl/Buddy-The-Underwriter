import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { hashTridentManifest, semanticTridentSnapshot, TRIDENT_VOLATILE_SNAPSHOT_KEYS } =
  require("../tridentInputSnapshot") as typeof import("../tridentInputSnapshot");

/**
 * Audit F-19. hashTridentManifest is the admission digest for a Golden
 * Trident run. It is computed once in the request that admits the run and
 * recomputed by assertTridentInputSnapshot inside every workflow step —
 * different invocations, potentially different machines.
 *
 * It used to order its canonical form with localeCompare, which resolves a
 * collation table from the runtime's default locale. Two invocations that
 * disagreed about the locale would produce different digests for identical
 * borrower data, and `input_snapshot_changed` is classified as permanent, so
 * the run would fail without retry and report that the inputs changed.
 *
 * These tests pin the property: the digest depends on the data and nothing
 * else about the process computing it.
 */

// Strings whose relative order genuinely differs between collations:
// Swedish sorts "ä" after "z"; most others sort it next to "a".
const LOCALE_SENSITIVE = ["zebra Corp", "äpple Holdings", "apple Ltd", "Ápex LLC", "_underscore"];

function manifest(names: string[]) {
  return {
    version: 6,
    sources: {
      deal: { id: "deal-1", legal_name: names[0] },
      applications: names.map((legal_name, i) => ({ id: `app-${i}`, legal_name })),
      documents: Object.fromEntries(names.map((n, i) => [`doc_${n}`, { i }])),
    },
    governedEvidenceAtAdmission: {},
    derivedAtAdmission: { memoInputHash: "memo-hash" },
  } as Record<string, unknown>;
}

test("[F-19] the digest does not depend on the process default locale", () => {
  const original = Intl.Collator;
  const target = manifest(LOCALE_SENSITIVE);
  const baseline = hashTridentManifest(target);

  // Force the environment a locale-sensitive comparator would read. If the
  // implementation consults a collation table at all, this moves it.
  const originalLocaleCompare = String.prototype.localeCompare;
  try {
    // eslint-disable-next-line no-extend-native
    String.prototype.localeCompare = function (this: string, that: string) {
      return originalLocaleCompare.call(this, that, "sv-SE");
    } as typeof String.prototype.localeCompare;
    assert.equal(
      hashTridentManifest(target),
      baseline,
      "digest changed when collation changed — the canonical form is locale-dependent",
    );
  } finally {
    // eslint-disable-next-line no-extend-native
    String.prototype.localeCompare = originalLocaleCompare;
    assert.equal(Intl.Collator, original);
  }
});

test("[F-19] sv-SE and en-US order these strings differently (the hazard is real)", () => {
  // Proves the fixture above actually exercises a collation difference, so
  // the test cannot pass vacuously on a locale-insensitive input set.
  const sv = [...LOCALE_SENSITIVE].sort((a, b) => a.localeCompare(b, "sv-SE"));
  const en = [...LOCALE_SENSITIVE].sort((a, b) => a.localeCompare(b, "en-US"));
  assert.notDeepEqual(sv, en);
});

test("[F-19] the digest is stable across repeated computation", () => {
  const target = manifest(LOCALE_SENSITIVE);
  const digests = new Set(Array.from({ length: 5 }, () => hashTridentManifest(target)));
  assert.equal(digests.size, 1);
});

test("[F-19] key insertion order does not change the digest", () => {
  const a = { version: 6, sources: { alpha: 1, beta: 2, gamma: [3, 4] } };
  const b = { sources: { gamma: [4, 3], beta: 2, alpha: 1 }, version: 6 };
  assert.equal(hashTridentManifest(a), hashTridentManifest(b));
});

test("[F-19] a real borrower value still changes the digest", () => {
  // The stability above must not have been bought by over-normalizing.
  const before = hashTridentManifest(manifest(LOCALE_SENSITIVE));
  const after = hashTridentManifest(manifest(["zebra Corp CHANGED", ...LOCALE_SENSITIVE.slice(1)]));
  assert.notEqual(before, after);
});

test("[F-19] volatile lifecycle keys are still excluded", () => {
  const withMetadata = semanticTridentSnapshot({
    legal_name: "Acme",
    updated_at: "2026-01-01T00:00:00Z",
    last_heartbeat_at: "2026-01-01T00:00:00Z",
  }) as Record<string, unknown>;
  assert.deepEqual(Object.keys(withMetadata), ["legal_name"]);
  assert.ok(TRIDENT_VOLATILE_SNAPSHOT_KEYS.has("last_heartbeat_at"));
});
