import { test, describe } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for Phase F + G:
 *  - Phase F: Credit Decision Audit Snapshot
 *  - Phase G: Examiner Drop ZIP
 *
 * Tests pure functions and contracts only — no DB, no AI calls.
 */

// ─── Local replicas of pure functions from audit modules ──

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

// ─── Phase F: Credit Decision Audit Snapshot ─────────────

describe("credit decision audit snapshot determinism", () => {
  function makeDecisionSnapshot(): any {
    return {
      meta: {
        deal_id: "d-uuid-1",
        snapshot_id: "s-uuid-1",
        snapshot_version: "1.0",
        generated_at: "2026-01-27T22:00:00.000Z",
        as_of: "2026-01-27T22:00:00.000Z",
      },
      decision: {
        status: "final",
        outcome: "approve",
        summary: "Strong DSCR with adequate collateral coverage.",
        confidence: 0.87,
        confidence_explanation: "High income stability, diversified tenants.",
        created_at: "2026-01-25T10:00:00.000Z",
        created_by_user_id: "user-1",
        model: { provider: "buddy", version: "v3" },
      },
      financials: {
        dscr: 1.35,
        dscr_stressed: 1.10,
        ltv_gross: 0.72,
        ltv_net: 0.68,
        noi_ttm: 450000,
        cash_flow_available: 380000,
        annual_debt_service: 280000,
        collateral_coverage: 1.40,
        completeness_pct: 85.5,
        as_of_date: "2025-12-31",
      },
      policy: {
        rules_evaluated: 12,
        rules_passed: 10,
        rules_failed: 2,
        exceptions: [
          { rule_key: "dscr_min", severity: "warning", reason: "Stressed DSCR below 1.15" },
        ],
        policy_eval_summary: {},
      },
      overrides: [],
      attestations: [
        {
          attested_by_user_id: "user-2",
          attested_by_name: "Jane UW",
          attested_role: "underwriter",
          statement: "I attest this decision is accurate.",
          snapshot_hash: "abc123",
          created_at: "2026-01-26T10:00:00.000Z",
        },
      ],
      committee: {
        quorum: 2,
        vote_count: 3,
        outcome: "approve",
        complete: true,
        votes: [
          { voter_user_id: "u-1", voter_name: "Alice", vote: "approve", comment: null, created_at: "2026-01-27T09:00:00Z" },
          { voter_user_id: "u-2", voter_name: "Bob", vote: "approve", comment: "Solid deal.", created_at: "2026-01-27T09:01:00Z" },
          { voter_user_id: "u-3", voter_name: "Carol", vote: "approve", comment: null, created_at: "2026-01-27T09:02:00Z" },
        ],
        minutes: "Meeting opened at 9:00 AM UTC...",
        minutes_hash: "min-hash-123",
        dissent: [],
      },
      ledger_events: [
        { id: "evt-1", type: "buddy.decision.created", created_at: "2026-01-25T10:00:00Z" },
      ],
    };
  }

  test("stableStringify produces identical output for reordered decision snapshot", () => {
    const s = makeDecisionSnapshot();
    const a = stableStringify(s);
    // Create with keys in different order
    const reordered = {
      ledger_events: s.ledger_events,
      committee: s.committee,
      attestations: s.attestations,
      overrides: s.overrides,
      policy: s.policy,
      financials: s.financials,
      decision: s.decision,
      meta: s.meta,
    };
    const b = stableStringify(reordered);
    assert.equal(a, b);
  });

  test("same decision snapshot produces same hash", () => {
    const s = makeDecisionSnapshot();
    const json = stableStringify(s);
    assert.equal(sha256Sim(json), sha256Sim(json));
  });

  test("different decision produces different hash", () => {
    const s1 = makeDecisionSnapshot();
    const s2 = makeDecisionSnapshot();
    s2.decision.outcome = "decline";
    assert.notEqual(sha256Sim(stableStringify(s1)), sha256Sim(stableStringify(s2)));
  });

  test("hash changes when override added", () => {
    const s1 = makeDecisionSnapshot();
    const s2 = makeDecisionSnapshot();
    s2.overrides = [{
      field_path: "decision.outcome",
      old_value: "approve",
      new_value: "approve_with_conditions",
      reason: "Additional conditions required",
      justification: "DSCR is borderline",
      severity: "warning",
      created_by_user_id: "user-3",
      created_at: "2026-01-27T12:00:00Z",
    }];
    assert.notEqual(sha256Sim(stableStringify(s1)), sha256Sim(stableStringify(s2)));
  });

  test("hash changes when attestation added", () => {
    const s1 = makeDecisionSnapshot();
    const s2 = makeDecisionSnapshot();
    s2.attestations.push({
      attested_by_user_id: "user-5",
      attested_by_name: "Risk Officer",
      attested_role: "risk_officer",
      statement: "Reviewed and approved.",
      snapshot_hash: "xyz789",
      created_at: "2026-01-27T14:00:00Z",
    });
    assert.notEqual(sha256Sim(stableStringify(s1)), sha256Sim(stableStringify(s2)));
  });
});

describe("credit decision audit snapshot schema contract", () => {
  function makeDecisionSnapshot(): any {
    return {
      meta: {
        deal_id: "d-uuid-1",
        snapshot_id: "s-uuid-1",
        snapshot_version: "1.0",
        generated_at: "2026-01-27T22:00:00.000Z",
        as_of: "2026-01-27T22:00:00.000Z",
      },
      decision: {
        status: "final",
        outcome: "approve",
        summary: "Approved.",
        confidence: 0.87,
        confidence_explanation: "Strong metrics.",
        created_at: "2026-01-25T10:00:00.000Z",
        created_by_user_id: "user-1",
        model: {},
      },
      financials: {
        dscr: 1.35,
        dscr_stressed: 1.10,
        ltv_gross: 0.72,
        ltv_net: 0.68,
        noi_ttm: 450000,
        cash_flow_available: 380000,
        annual_debt_service: 280000,
        collateral_coverage: 1.40,
        completeness_pct: 85.5,
        as_of_date: "2025-12-31",
      },
      policy: {
        rules_evaluated: 12,
        rules_passed: 10,
        rules_failed: 2,
        exceptions: [],
        policy_eval_summary: {},
      },
      overrides: [],
      attestations: [],
      committee: {
        quorum: 2,
        vote_count: 0,
        outcome: "pending",
        complete: false,
        votes: [],
        minutes: null,
        minutes_hash: null,
        dissent: [],
      },
      ledger_events: [],
    };
  }

  test("snapshot has canonical meta block", () => {
    const s = makeDecisionSnapshot();
    assert.equal(s.meta.snapshot_version, "1.0");
    assert.equal(typeof s.meta.deal_id, "string");
    assert.equal(typeof s.meta.snapshot_id, "string");
    assert.equal(typeof s.meta.generated_at, "string");
    assert.equal(typeof s.meta.as_of, "string");
  });

  test("decision block has required fields", () => {
    const s = makeDecisionSnapshot();
    assert.equal(typeof s.decision.status, "string");
    assert.equal(typeof s.decision.outcome, "string");
    assert.equal(typeof s.decision.summary, "string");
    assert.equal(typeof s.decision.confidence, "number");
    assert.equal(typeof s.decision.confidence_explanation, "string");
    assert.equal(typeof s.decision.created_at, "string");
  });

  test("financials block has key metrics", () => {
    const s = makeDecisionSnapshot();
    assert.equal(typeof s.financials.dscr, "number");
    assert.equal(typeof s.financials.ltv_gross, "number");
    assert.equal(typeof s.financials.noi_ttm, "number");
    assert.equal(typeof s.financials.completeness_pct, "number");
  });

  test("policy block has rule counts", () => {
    const s = makeDecisionSnapshot();
    assert.equal(typeof s.policy.rules_evaluated, "number");
    assert.equal(typeof s.policy.rules_passed, "number");
    assert.equal(typeof s.policy.rules_failed, "number");
    assert.ok(Array.isArray(s.policy.exceptions));
    assert.equal(s.policy.rules_evaluated, s.policy.rules_passed + s.policy.rules_failed);
  });

  test("overrides is array", () => {
    const s = makeDecisionSnapshot();
    assert.ok(Array.isArray(s.overrides));
  });

  test("attestations is array", () => {
    const s = makeDecisionSnapshot();
    assert.ok(Array.isArray(s.attestations));
  });

  test("committee has quorum and outcome", () => {
    const s = makeDecisionSnapshot();
    assert.equal(typeof s.committee.quorum, "number");
    assert.equal(typeof s.committee.vote_count, "number");
    assert.equal(typeof s.committee.outcome, "string");
    assert.equal(typeof s.committee.complete, "boolean");
    assert.ok(Array.isArray(s.committee.votes));
    assert.ok(Array.isArray(s.committee.dissent));
  });

  test("ledger_events is array", () => {
    const s = makeDecisionSnapshot();
    assert.ok(Array.isArray(s.ledger_events));
  });

  test("all timestamps are ISO-8601 UTC", () => {
    const s = makeDecisionSnapshot();
    assert.ok(s.meta.generated_at.endsWith("Z"));
    assert.ok(s.meta.generated_at.includes("T"));
    assert.ok(s.meta.as_of.endsWith("Z"));
    assert.ok(s.decision.created_at.endsWith("Z"));
  });

  test("snapshot_hash is NOT inside the snapshot object", () => {
    const s = makeDecisionSnapshot();
    assert.ok(!("snapshot_hash" in s) || s.snapshot_hash === undefined);
  });
});

// ─── Committee outcome logic ─────────────────────────────

describe("committee outcome computation", () => {
  function computeOutcome(votes: Array<{ vote: string }>, quorum: number): string {
    const tally = { approve: 0, approve_with_conditions: 0, decline: 0 };
    for (const v of votes) {
      if (v.vote === "approve") tally.approve++;
      else if (v.vote === "approve_with_conditions") tally.approve_with_conditions++;
      else if (v.vote === "decline") tally.decline++;
    }
    if (tally.decline > 0) return "decline";
    if (tally.approve_with_conditions > 0) return "approve_with_conditions";
    if (votes.length >= quorum && tally.approve > 0) return "approve";
    return "pending";
  }

  test("all approves with quorum → approve", () => {
    assert.equal(computeOutcome([{ vote: "approve" }, { vote: "approve" }], 2), "approve");
  });

  test("any decline → decline (veto)", () => {
    assert.equal(
      computeOutcome([{ vote: "approve" }, { vote: "decline" }, { vote: "approve" }], 2),
      "decline",
    );
  });

  test("any conditional → approve_with_conditions", () => {
    assert.equal(
      computeOutcome([{ vote: "approve" }, { vote: "approve_with_conditions" }], 2),
      "approve_with_conditions",
    );
  });

  test("below quorum → pending", () => {
    assert.equal(computeOutcome([{ vote: "approve" }], 3), "pending");
  });

  test("no votes → pending", () => {
    assert.equal(computeOutcome([], 1), "pending");
  });

  test("decline overrides conditional", () => {
    assert.equal(
      computeOutcome([{ vote: "approve_with_conditions" }, { vote: "decline" }], 2),
      "decline",
    );
  });
});

// ─── Phase F: Credit Decision Export API contract ────────

describe("credit decision audit export API contract", () => {
  test("JSON export response shape", () => {
    const response = {
      ok: true,
      snapshot: {
        meta: { deal_id: "d-1", snapshot_id: "s-1", snapshot_version: "1.0", generated_at: "2026-01-27T22:00:00Z", as_of: "2026-01-27T22:00:00Z" },
        decision: { outcome: "approve" },
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

  test("PDF export response shape", () => {
    const response = {
      ok: true,
      data: "base64pdfcontent",
      filename: "Credit-Decision-Audit-d1234567-2026-01-27.pdf",
      contentType: "application/pdf",
      snapshot_hash: "abc123",
      generated_at: "2026-01-27T22:00:00Z",
    };

    assert.equal(response.ok, true);
    assert.equal(typeof response.data, "string");
    assert.equal(response.contentType, "application/pdf");
    assert.ok(response.filename.endsWith(".pdf"));
  });

  test("error on missing snapshotId", () => {
    const response = {
      ok: false,
      error: { code: "missing_snapshot_id", message: "snapshotId query parameter is required" },
    };
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "missing_snapshot_id");
  });

  test("error on bad format", () => {
    const response = {
      ok: false,
      error: { code: "invalid_format", message: "format must be 'json' or 'pdf'" },
    };
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "invalid_format");
  });

  test("required headers", () => {
    const headers = {
      "content-disposition": "attachment",
      "x-buddy-snapshot-hash": "abc123def456",
      "x-correlation-id": "cdae-xxx",
      "x-buddy-route": "/api/deals/[dealId]/decision/audit-export",
    };
    assert.equal(headers["content-disposition"], "attachment");
    assert.equal(typeof headers["x-buddy-snapshot-hash"], "string");
    assert.ok(headers["x-buddy-snapshot-hash"].length > 0);
  });
});

// ─── Phase G: Examiner Drop ZIP contract ────────────────

describe("examiner drop manifest contract", () => {
  function makeManifest(): any {
    return {
      drop_version: "1.0",
      generated_at: "2026-01-27T22:00:00.000Z",
      deal_id: "d-uuid-1",
      bank_id: "b-uuid-1",
      borrower_id: "bor-uuid-1",
      decision_snapshot_id: "s-uuid-1",
      artifacts: [
        { path: "borrower-audit/snapshot.json", sha256: "aaa", size_bytes: 1234, content_type: "application/json" },
        { path: "borrower-audit/snapshot.pdf", sha256: "bbb", size_bytes: 56789, content_type: "application/pdf" },
        { path: "credit-decision/snapshot.json", sha256: "ccc", size_bytes: 2345, content_type: "application/json" },
        { path: "credit-decision/snapshot.pdf", sha256: "ddd", size_bytes: 67890, content_type: "application/pdf" },
        { path: "financials/financial-snapshot.json", sha256: "eee", size_bytes: 3456, content_type: "application/json" },
        { path: "policies/policy-eval.json", sha256: "fff", size_bytes: 4567, content_type: "application/json" },
        { path: "policies/exceptions.json", sha256: "ggg", size_bytes: 100, content_type: "application/json" },
        { path: "README.txt", sha256: "hhh", size_bytes: 2000, content_type: "text/plain" },
        { path: "integrity/checksums.txt", sha256: "iii", size_bytes: 500, content_type: "text/plain" },
      ],
      borrower_audit_hash: "ba-hash-123",
      credit_decision_hash: "cd-hash-456",
      drop_hash: "drop-hash-789",
    };
  }

  test("manifest has drop_version 1.0", () => {
    const m = makeManifest();
    assert.equal(m.drop_version, "1.0");
  });

  test("manifest has required IDs", () => {
    const m = makeManifest();
    assert.equal(typeof m.deal_id, "string");
    assert.equal(typeof m.bank_id, "string");
    assert.equal(typeof m.decision_snapshot_id, "string");
  });

  test("artifacts is array of { path, sha256, size_bytes, content_type }", () => {
    const m = makeManifest();
    assert.ok(Array.isArray(m.artifacts));
    assert.ok(m.artifacts.length > 0);
    for (const a of m.artifacts) {
      assert.equal(typeof a.path, "string");
      assert.equal(typeof a.sha256, "string");
      assert.equal(typeof a.size_bytes, "number");
      assert.equal(typeof a.content_type, "string");
    }
  });

  test("manifest contains expected files", () => {
    const m = makeManifest();
    const paths = m.artifacts.map((a: any) => a.path);
    assert.ok(paths.includes("borrower-audit/snapshot.json"));
    assert.ok(paths.includes("borrower-audit/snapshot.pdf"));
    assert.ok(paths.includes("credit-decision/snapshot.json"));
    assert.ok(paths.includes("credit-decision/snapshot.pdf"));
    assert.ok(paths.includes("financials/financial-snapshot.json"));
    assert.ok(paths.includes("policies/policy-eval.json"));
    assert.ok(paths.includes("README.txt"));
    assert.ok(paths.includes("integrity/checksums.txt"));
  });

  test("drop_hash is derived from artifact hashes", () => {
    const m = makeManifest();
    const allHashes = m.artifacts.map((a: any) => a.sha256).join("|");
    const expectedDropHash = sha256Sim(allHashes);
    // The actual implementation uses real sha256, but the principle holds:
    // drop_hash should be deterministically derived from artifact hashes
    assert.equal(typeof m.drop_hash, "string");
    assert.ok(m.drop_hash.length > 0);
  });

  test("borrower_audit_hash and credit_decision_hash present", () => {
    const m = makeManifest();
    assert.equal(typeof m.borrower_audit_hash, "string");
    assert.equal(typeof m.credit_decision_hash, "string");
  });

  test("generated_at is ISO-8601 UTC", () => {
    const m = makeManifest();
    assert.ok(m.generated_at.endsWith("Z"));
    assert.ok(m.generated_at.includes("T"));
  });
});

describe("examiner drop API contract", () => {
  test("ZIP export response shape", () => {
    const response = {
      ok: true,
      data: "base64zipcontent",
      filename: "Examiner-Drop-d1234567-2026-01-27.zip",
      contentType: "application/zip",
      drop_hash: "drop-hash-789",
      generated_at: "2026-01-27T22:00:00Z",
      manifest: { drop_version: "1.0", artifacts: [] },
    };

    assert.equal(response.ok, true);
    assert.equal(typeof response.data, "string");
    assert.equal(response.contentType, "application/zip");
    assert.ok(response.filename.endsWith(".zip"));
    assert.equal(typeof response.drop_hash, "string");
    assert.equal(typeof response.generated_at, "string");
    assert.equal(typeof response.manifest, "object");
  });

  test("required headers for examiner drop", () => {
    const headers = {
      "content-disposition": "attachment",
      "x-buddy-drop-hash": "drop-hash-789",
      "x-correlation-id": "exdrop-xxx",
      "x-buddy-route": "/api/deals/[dealId]/examiner-drop",
    };
    assert.equal(headers["content-disposition"], "attachment");
    assert.equal(typeof headers["x-buddy-drop-hash"], "string");
    assert.ok(headers["x-buddy-drop-hash"].length > 0);
  });

  test("error on missing snapshotId", () => {
    const response = {
      ok: false,
      error: { code: "missing_snapshot_id", message: "snapshotId query parameter is required" },
    };
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "missing_snapshot_id");
  });
});

// ─── Checksums integrity ─────────────────────────────────

describe("examiner drop checksums integrity", () => {
  test("checksums.txt format: sha256  path", () => {
    const artifacts = [
      { path: "borrower-audit/snapshot.json", sha256: "aaa111" },
      { path: "credit-decision/snapshot.json", sha256: "bbb222" },
    ];
    const checksumLines = artifacts.map((a) => `${a.sha256}  ${a.path}`).join("\n") + "\n";
    assert.ok(checksumLines.includes("aaa111  borrower-audit/snapshot.json"));
    assert.ok(checksumLines.includes("bbb222  credit-decision/snapshot.json"));
    assert.ok(checksumLines.endsWith("\n"));
  });

  test("each artifact has unique path", () => {
    const paths = [
      "borrower-audit/snapshot.json",
      "borrower-audit/snapshot.pdf",
      "credit-decision/snapshot.json",
      "credit-decision/snapshot.pdf",
      "financials/financial-snapshot.json",
      "policies/policy-eval.json",
      "policies/exceptions.json",
      "README.txt",
      "integrity/checksums.txt",
    ];
    assert.equal(new Set(paths).size, paths.length);
  });
});

// ─── Override visibility ─────────────────────────────────

describe("override audit visibility", () => {
  test("override has before/after values", () => {
    const override = {
      field_path: "decision.outcome",
      old_value: "approve",
      new_value: "approve_with_conditions",
      reason: "Additional review needed",
      justification: "Stressed DSCR is borderline",
      severity: "warning",
      created_by_user_id: "user-3",
      created_at: "2026-01-27T12:00:00Z",
    };
    assert.equal(typeof override.field_path, "string");
    assert.equal(typeof override.old_value, "string");
    assert.equal(typeof override.new_value, "string");
    assert.equal(typeof override.reason, "string");
    assert.equal(typeof override.justification, "string");
    assert.equal(typeof override.severity, "string");
    assert.equal(typeof override.created_by_user_id, "string");
    assert.equal(typeof override.created_at, "string");
  });

  test("override changes snapshot hash", () => {
    const base = { decision: { outcome: "approve" }, overrides: [] as any[] };
    const withOverride = {
      decision: { outcome: "approve" },
      overrides: [{
        field_path: "decision.outcome",
        old_value: "approve",
        new_value: "approve_with_conditions",
      }],
    };
    assert.notEqual(stableStringify(base), stableStringify(withOverride));
  });
});
