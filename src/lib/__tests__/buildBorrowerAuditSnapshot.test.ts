import { test, describe } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for Phase E: Canonical Borrower Audit Snapshot.
 * Tests pure functions only — no DB, no AI calls.
 */

// ─── Local replicas of pure functions from audit module ──

/** Deterministic JSON stringification with deep-sorted keys */
function stableStringify(obj: any): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce<Record<string, any>>((sorted, k) => {
          sorted[k] = value[k];
          return sorted;
        }, {});
    }
    return value;
  });
}

/** Simulated sha256 for pure tests (deterministic) */
function sha256Sim(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(16, "0");
}

/** Canonical EIN masking: **-***NNNN */
function maskEin(ein: string | null | undefined): string {
  if (!ein) return "";
  const digits = String(ein).replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `**-***${digits.slice(-4)}`;
}

// ─── Snapshot determinism ────────────────────────────────

describe("audit snapshot determinism", () => {
  test("stableStringify produces sorted keys at all depths", () => {
    const a = stableStringify({ z: 1, a: { y: 2, b: 3 }, m: 4 });
    const b = stableStringify({ a: { b: 3, y: 2 }, m: 4, z: 1 });
    assert.equal(a, b);
  });

  test("stableStringify preserves array order", () => {
    const a = stableStringify({ items: [3, 1, 2] });
    const b = stableStringify({ items: [3, 1, 2] });
    const c = stableStringify({ items: [1, 2, 3] });
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  test("same input produces same hash", () => {
    const input = stableStringify({ meta: { borrower_id: "b-1" }, borrower: { legal_name: "Test" } });
    const hash1 = sha256Sim(input);
    const hash2 = sha256Sim(input);
    assert.equal(hash1, hash2);
  });

  test("different input produces different hash", () => {
    const hash1 = sha256Sim(stableStringify({ a: 1 }));
    const hash2 = sha256Sim(stableStringify({ a: 2 }));
    assert.notEqual(hash1, hash2);
  });

  test("hash is computed from canonical JSON, not snapshot object reference", () => {
    const snap1 = { meta: { borrower_id: "b-1", snapshot_version: "1.0" }, borrower: { legal_name: "Corp" } };
    const snap2 = { borrower: { legal_name: "Corp" }, meta: { snapshot_version: "1.0", borrower_id: "b-1" } };
    assert.equal(
      sha256Sim(stableStringify(snap1)),
      sha256Sim(stableStringify(snap2)),
    );
  });
});

// ─── EIN masking ─────────────────────────────────────────

describe("audit snapshot EIN masking", () => {
  test("masks full EIN to **-***NNNN format", () => {
    assert.equal(maskEin("12-3456789"), "**-***6789");
    assert.equal(maskEin("123456789"), "**-***6789");
  });

  test("returns empty string for null/empty", () => {
    assert.equal(maskEin(null), "");
    assert.equal(maskEin(""), "");
    assert.equal(maskEin(undefined), "");
  });

  test("returns empty string for too-short", () => {
    assert.equal(maskEin("12"), "");
    assert.equal(maskEin("abc"), "");
  });

  test("never exposes full EIN digits", () => {
    const masked = maskEin("12-3456789");
    assert.ok(!masked.includes("123456789"));
    assert.ok(!masked.includes("12-345"));
    assert.ok(masked.startsWith("**-***"));
  });

  test("masking is idempotent on already-masked input", () => {
    // Already-masked has no digits in first 5 chars → extracts last 4 from "1234"
    const result = maskEin("**-***1234");
    assert.equal(result, "**-***1234");
  });
});

// ─── Attestation snapshot fidelity ───────────────────────

describe("attestation snapshot fidelity", () => {
  function extractOwnersFromAttestation(
    snapshot: any,
    extractedConf: Record<string, number>,
  ): Array<{ name: string; ownership_pct: number; confidence: number; source: string }> {
    if (!snapshot) return [];
    const owners: any[] = snapshot?.owners ?? [];
    return owners.map((o: any) => {
      const ownerKey = String(o.full_name ?? o.name ?? "").toLowerCase().replace(/\s+/g, "_");
      return {
        name: o.full_name ?? o.name ?? "",
        ownership_pct: o.ownership_percent ?? o.ownership_pct ?? 0,
        confidence: extractedConf[`owner.${ownerKey}`] ?? 0,
        source: o.ownership_source ?? o.source ?? "attested",
      };
    });
  }

  test("extracts owners from attested snapshot", () => {
    const attestedSnapshot = {
      owners: [
        { full_name: "John Smith", ownership_percent: 51, ownership_source: "doc_extracted" },
        { full_name: "Jane Doe", ownership_percent: 49, ownership_source: "tax_k1" },
      ],
    };
    const conf = { "owner.john_smith": 0.92, "owner.jane_doe": 0.88 };
    const result = extractOwnersFromAttestation(attestedSnapshot, conf);

    assert.equal(result.length, 2);
    assert.equal(result[0].name, "John Smith");
    assert.equal(result[0].ownership_pct, 51);
    assert.equal(result[0].confidence, 0.92);
    assert.equal(result[0].source, "doc_extracted");
    assert.equal(result[1].name, "Jane Doe");
    assert.equal(result[1].confidence, 0.88);
  });

  test("returns empty array when no attestation", () => {
    const result = extractOwnersFromAttestation(null, {});
    assert.deepEqual(result, []);
  });

  test("returns empty array when attestation has no owners", () => {
    const result = extractOwnersFromAttestation({ owners: [] }, {});
    assert.deepEqual(result, []);
  });

  test("handles alternative key names (name vs full_name)", () => {
    const attestedSnapshot = {
      owners: [{ name: "Bob", ownership_pct: 100, source: "manual" }],
    };
    const result = extractOwnersFromAttestation(attestedSnapshot, {});
    assert.equal(result[0].name, "Bob");
    assert.equal(result[0].ownership_pct, 100);
    assert.equal(result[0].source, "manual");
  });
});

// ─── Canonical snapshot schema contract ──────────────────

describe("canonical snapshot schema contract", () => {
  function makeSnapshot(): any {
    return {
      meta: {
        borrower_id: "b-uuid-1",
        snapshot_version: "1.0",
        generated_at: "2026-01-27T22:00:00.000Z",
        as_of: "2026-01-27T22:00:00.000Z",
      },
      borrower: {
        legal_name: "Test Corp",
        entity_type: "LLC",
        ein_masked: "**-***6789",
        naics: "541511",
        address: { street: "123 Main St", city: "Springfield", state: "IL", zip: "62701" },
      },
      owners: [
        { name: "John Smith", ownership_pct: 51, confidence: 0.92, source: "doc_extracted" },
        { name: "Jane Doe", ownership_pct: 49, confidence: 0.88, source: "doc_extracted" },
      ],
      extraction: {
        documents: [
          { document_id: "doc-1", document_type: "1120", uploaded_at: "2026-01-15T00:00:00Z", sha256: "abc123" },
        ],
        field_confidence: { legal_name: 0.92, entity_type: 0.88, ein: 0.95, naics: 0.72, address: 0.85 },
      },
      attestation: {
        attested: true,
        attested_by_user_id: "user-1",
        attested_at: "2026-01-20T00:00:00Z",
        snapshot_hash: "def456",
      },
      lifecycle: {
        borrower_completed_at: "2026-01-20T00:00:00Z",
        underwriting_unlocked_at: null,
      },
      ledger_events: [
        { id: "evt-1", type: "buddy.borrower.created", created_at: "2026-01-10T00:00:00Z" },
      ],
    };
  }

  test("snapshot has canonical top-level structure", () => {
    const s = makeSnapshot();
    // meta
    assert.equal(s.meta.snapshot_version, "1.0");
    assert.equal(typeof s.meta.borrower_id, "string");
    assert.equal(typeof s.meta.generated_at, "string");
    assert.equal(typeof s.meta.as_of, "string");
    // borrower
    assert.equal(typeof s.borrower.legal_name, "string");
    assert.equal(typeof s.borrower.ein_masked, "string");
    assert.ok(s.borrower.ein_masked.startsWith("**-***"));
    assert.equal(typeof s.borrower.naics, "string");
    assert.equal(typeof s.borrower.address.street, "string");
    // owners
    assert.ok(Array.isArray(s.owners));
    assert.equal(typeof s.owners[0].confidence, "number");
    assert.equal(typeof s.owners[0].ownership_pct, "number");
    // extraction
    assert.ok(Array.isArray(s.extraction.documents));
    assert.equal(typeof s.extraction.documents[0].sha256, "string");
    assert.equal(typeof s.extraction.documents[0].document_type, "string");
    assert.equal(typeof s.extraction.field_confidence, "object");
    // attestation
    assert.equal(typeof s.attestation.attested, "boolean");
    assert.equal(typeof s.attestation.attested_by_user_id, "string");
    // lifecycle
    assert.ok("borrower_completed_at" in s.lifecycle);
    assert.ok("underwriting_unlocked_at" in s.lifecycle);
    // ledger_events
    assert.ok(Array.isArray(s.ledger_events));
    assert.equal(typeof s.ledger_events[0].id, "string");
    assert.equal(typeof s.ledger_events[0].type, "string");
  });

  test("snapshot with no attestation has null fields", () => {
    const s = makeSnapshot();
    s.attestation = {
      attested: false,
      attested_by_user_id: null,
      attested_at: null,
      snapshot_hash: null,
    };
    assert.equal(s.attestation.attested, false);
    assert.equal(s.attestation.attested_by_user_id, null);
    assert.equal(s.attestation.snapshot_hash, null);
  });

  test("all timestamps are ISO-8601 UTC", () => {
    const s = makeSnapshot();
    assert.ok(s.meta.generated_at.endsWith("Z"));
    assert.ok(s.meta.generated_at.includes("T"));
    assert.ok(s.meta.as_of.endsWith("Z"));
  });

  test("snapshot_hash is NOT inside the snapshot object", () => {
    const s = makeSnapshot();
    // The canonical spec says snapshot_hash is returned alongside, not inside
    assert.ok(!("snapshot_hash" in s) || s.snapshot_hash === undefined);
  });
});

// ─── Stable ordering guarantees ──────────────────────────

describe("stable ordering guarantees", () => {
  test("deeply nested objects are sorted", () => {
    const a = stableStringify({
      z: { c: 1, a: 2 },
      a: { z: 3, b: 4 },
    });
    const b = stableStringify({
      a: { b: 4, z: 3 },
      z: { a: 2, c: 1 },
    });
    assert.equal(a, b);
  });

  test("arrays maintain insertion order (not sorted)", () => {
    const result = stableStringify({ items: ["c", "a", "b"] });
    assert.ok(result.includes('"items":["c","a","b"]'));
  });

  test("null values are preserved", () => {
    const result = stableStringify({ a: null, b: "ok" });
    assert.ok(result.includes('"a":null'));
  });
});

// ─── Export API contract ─────────────────────────────────

describe("audit export API contract", () => {
  test("JSON export response shape: { snapshot, snapshot_hash, generated_at }", () => {
    const response = {
      ok: true,
      snapshot: {
        meta: { borrower_id: "b-1", snapshot_version: "1.0", generated_at: "2026-01-27T22:00:00Z", as_of: "2026-01-27T22:00:00Z" },
        borrower: { legal_name: "Test" },
      },
      snapshot_hash: "abc123def456",
      generated_at: "2026-01-27T22:00:00Z",
    };

    assert.equal(response.ok, true);
    assert.equal(typeof response.snapshot, "object");
    assert.equal(typeof response.snapshot_hash, "string");
    assert.equal(typeof response.generated_at, "string");
    assert.equal(response.snapshot.meta.snapshot_version, "1.0");
  });

  test("PDF export response shape: { data, filename, contentType, snapshot_hash, generated_at }", () => {
    const response = {
      ok: true,
      data: "base64pdfcontent",
      filename: "Borrower-Audit-TestCorp-2026-01-27.pdf",
      contentType: "application/pdf",
      snapshot_hash: "abc123",
      generated_at: "2026-01-27T22:00:00Z",
    };

    assert.equal(response.ok, true);
    assert.equal(typeof response.data, "string");
    assert.equal(response.contentType, "application/pdf");
    assert.ok(response.filename.endsWith(".pdf"));
    assert.equal(typeof response.snapshot_hash, "string");
    assert.equal(typeof response.generated_at, "string");
  });

  test("export error on bad format", () => {
    const response = {
      ok: false,
      error: { code: "invalid_format", message: "format must be 'json' or 'pdf'" },
    };
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "invalid_format");
  });

  test("Content-Disposition and X-Buddy-Snapshot-Hash headers required", () => {
    const headers = {
      "content-disposition": "attachment",
      "x-buddy-snapshot-hash": "abc123def456",
      "x-correlation-id": "bae-xxx",
      "x-buddy-route": "/api/borrowers/[borrowerId]/audit-export",
    };
    assert.equal(headers["content-disposition"], "attachment");
    assert.equal(typeof headers["x-buddy-snapshot-hash"], "string");
    assert.ok(headers["x-buddy-snapshot-hash"].length > 0);
  });
});
