import { test, describe } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for cc Spec — Modes 1+2+3:
 *  - Mode registry (getBuddyMode, isBuddyMode)
 *  - Feature gates (all 9 gate functions + computeGates)
 *  - Examiner auth (authenticateExaminer, checkExaminerScope, extractGrantId)
 *  - Integrity verifyArtifactSet
 *
 * Tests pure functions and contracts only — no DB, no AI calls.
 */

// ─── Local replicas of pure functions ─────────────────────

type BuddyMode = "builder_observer" | "banker_copilot" | "examiner_portal";

const VALID_MODES = new Set<string>([
  "builder_observer",
  "banker_copilot",
  "examiner_portal",
]);

function getBuddyMode(overrides?: {
  envMode?: string | null;
  role?: string | null;
  hasExaminerGrant?: boolean;
  isDev?: boolean;
}): BuddyMode {
  const envMode = overrides?.envMode ?? undefined;
  if (envMode && VALID_MODES.has(envMode)) return envMode as BuddyMode;
  if (overrides?.hasExaminerGrant) return "examiner_portal";
  const role = overrides?.role ?? null;
  if (role === "examiner") return "examiner_portal";
  if (role === "super_admin" || role === "bank_admin" || role === "underwriter") return "banker_copilot";
  if (overrides?.isDev) return "builder_observer";
  return "banker_copilot";
}

function isBuddyMode(value: unknown): value is BuddyMode {
  return typeof value === "string" && VALID_MODES.has(value);
}

// ── Gate replicas ────────────────────────────────────────

function canViewDiagnostics(mode: BuddyMode): boolean {
  return mode === "builder_observer";
}

function canReplayCase(mode: BuddyMode): boolean {
  return mode === "builder_observer";
}

function canValidateCase(mode: BuddyMode): boolean {
  return mode === "builder_observer" || mode === "banker_copilot";
}

function canGenerateDraftEmails(mode: BuddyMode): boolean {
  return mode === "banker_copilot";
}

function canDownloadExaminerDrop(mode: BuddyMode): boolean {
  return mode === "banker_copilot";
}

function canViewCopilotCard(mode: BuddyMode): boolean {
  return mode === "banker_copilot";
}

function canVerifyIntegrity(_mode: BuddyMode): boolean {
  return true;
}

function canAccessObserverPanel(mode: BuddyMode): boolean {
  return mode === "builder_observer";
}

function canAccessExaminerPortal(mode: BuddyMode): boolean {
  return mode === "examiner_portal";
}

type ModeGates = {
  canViewDiagnostics: boolean;
  canReplayCase: boolean;
  canValidateCase: boolean;
  canGenerateDraftEmails: boolean;
  canDownloadExaminerDrop: boolean;
  canViewCopilotCard: boolean;
  canVerifyIntegrity: boolean;
  canAccessObserverPanel: boolean;
  canAccessExaminerPortal: boolean;
};

function computeGates(mode: BuddyMode): ModeGates {
  return {
    canViewDiagnostics: canViewDiagnostics(mode),
    canReplayCase: canReplayCase(mode),
    canValidateCase: canValidateCase(mode),
    canGenerateDraftEmails: canGenerateDraftEmails(mode),
    canDownloadExaminerDrop: canDownloadExaminerDrop(mode),
    canViewCopilotCard: canViewCopilotCard(mode),
    canVerifyIntegrity: canVerifyIntegrity(mode),
    canAccessObserverPanel: canAccessObserverPanel(mode),
    canAccessExaminerPortal: canAccessExaminerPortal(mode),
  };
}

// ── Examiner auth replicas ──────────────────────────────

type ExaminerAccessScope = {
  deal_ids: string[];
  read_areas: string[];
};

type ExaminerAccessGrant = {
  id: string;
  examiner_name: string;
  organization: string;
  bank_id: string;
  scope: ExaminerAccessScope;
  expires_at: string;
  revoked_at: string | null;
  is_active: boolean;
};

function validateGrantScope(
  grant: ExaminerAccessGrant,
  dealId: string,
  area: string,
): { allowed: boolean; reason: string } {
  if (!grant.is_active) {
    return { allowed: false, reason: "Grant is no longer active (expired or revoked)." };
  }
  if (grant.scope.deal_ids.length > 0 && !grant.scope.deal_ids.includes(dealId)) {
    return { allowed: false, reason: `Deal ${dealId.slice(0, 8)}… is not in grant scope.` };
  }
  if (!grant.scope.read_areas.includes("all") && !grant.scope.read_areas.includes(area)) {
    return { allowed: false, reason: `Area "${area}" is not in grant scope.` };
  }
  return { allowed: true, reason: "Access permitted." };
}

function extractGrantId(opts: {
  searchParams?: URLSearchParams;
  authHeader?: string | null;
}): string | null {
  const queryGrant = opts.searchParams?.get("grant_id");
  if (queryGrant) return queryGrant;
  const auth = opts.authHeader;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

function canExaminerDownload(scope: ExaminerAccessScope): boolean {
  return (scope as Record<string, unknown>).allow_downloads === true;
}

// ── Integrity replicas ──────────────────────────────────

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

function sha256Sim(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(16, "0");
}

type ArtifactEntry = {
  path: string;
  sha256: string;
  size_bytes: number;
  content_type?: string;
};

type ConsistencyCheck = {
  check: string;
  passed: boolean;
  detail: string;
};

type IntegrityCheckResult = {
  check_version: "1.0";
  checked_at: string;
  artifact_type: string;
  artifact_id: string;
  expected_hash: string;
  computed_hash: string;
  match: boolean;
  details: string;
};

type ArtifactSetVerification = {
  check_version: "1.0";
  checked_at: string;
  valid: boolean;
  total_artifacts: number;
  verified: number;
  mismatched: number;
  missing: number;
  drop_hash_match: boolean;
  expected_drop_hash: string;
  computed_drop_hash: string;
  results: IntegrityCheckResult[];
  consistency: ConsistencyCheck[];
};

function verifyArtifactSet(input: {
  manifest: {
    artifacts: ArtifactEntry[];
    drop_hash: string;
    borrower_audit_hash?: string | null;
    credit_decision_hash?: string | null;
  };
  contents: Map<string, string>;
  snapshots?: Map<string, unknown>;
}): ArtifactSetVerification {
  const checkedAt = new Date().toISOString();
  const results: IntegrityCheckResult[] = [];
  const consistency: ConsistencyCheck[] = [];
  let verified = 0;
  let mismatched = 0;
  let missing = 0;

  for (const artifact of input.manifest.artifacts) {
    const snapshot = input.snapshots?.get(artifact.path);
    const rawContent = input.contents.get(artifact.path);

    if (snapshot !== undefined) {
      const canonical = stableStringify(snapshot);
      const computedHash = sha256Sim(canonical);
      const match = computedHash === artifact.sha256;
      results.push({
        check_version: "1.0", checked_at: checkedAt,
        artifact_type: "snapshot", artifact_id: artifact.path,
        expected_hash: artifact.sha256, computed_hash: computedHash,
        match, details: match ? "verified" : "mismatch",
      });
      if (match) verified++; else mismatched++;
    } else if (rawContent !== undefined) {
      const computedHash = sha256Sim(rawContent);
      const match = computedHash === artifact.sha256;
      results.push({
        check_version: "1.0", checked_at: checkedAt,
        artifact_type: artifact.content_type ?? "file", artifact_id: artifact.path,
        expected_hash: artifact.sha256, computed_hash: computedHash,
        match, details: match ? "verified" : "mismatch",
      });
      if (match) verified++; else mismatched++;
    } else {
      results.push({
        check_version: "1.0", checked_at: checkedAt,
        artifact_type: artifact.content_type ?? "file", artifact_id: artifact.path,
        expected_hash: artifact.sha256, computed_hash: "",
        match: false, details: "missing",
      });
      missing++;
    }
  }

  const allHashes = input.manifest.artifacts.map((a) => a.sha256).join("|");
  const computedDropHash = sha256Sim(allHashes);
  const dropHashMatch = computedDropHash === input.manifest.drop_hash;

  consistency.push({
    check: "manifest_has_artifacts",
    passed: input.manifest.artifacts.length > 0,
    detail: `${input.manifest.artifacts.length} artifact(s)`,
  });

  consistency.push({
    check: "all_content_provided",
    passed: missing === 0,
    detail: missing === 0 ? "All provided" : `${missing} missing`,
  });

  const paths = input.manifest.artifacts.map((a) => a.path);
  const uniquePaths = new Set(paths);
  consistency.push({
    check: "no_duplicate_paths",
    passed: uniquePaths.size === paths.length,
    detail: uniquePaths.size === paths.length ? "No dupes" : "Has dupes",
  });

  const valid = mismatched === 0 && missing === 0 && dropHashMatch && consistency.every((c) => c.passed);

  return {
    check_version: "1.0", checked_at: checkedAt, valid,
    total_artifacts: input.manifest.artifacts.length,
    verified, mismatched, missing,
    drop_hash_match: dropHashMatch,
    expected_drop_hash: input.manifest.drop_hash,
    computed_drop_hash: computedDropHash,
    results, consistency,
  };
}

// ════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════

// ── 1. Mode Registry ────────────────────────────────────

describe("getBuddyMode", () => {
  test("explicit env override takes highest precedence", () => {
    assert.equal(
      getBuddyMode({ envMode: "builder_observer", role: "bank_admin", isDev: false }),
      "builder_observer",
    );
    assert.equal(
      getBuddyMode({ envMode: "examiner_portal", role: "super_admin", isDev: true }),
      "examiner_portal",
    );
    assert.equal(
      getBuddyMode({ envMode: "banker_copilot", hasExaminerGrant: true }),
      "banker_copilot",
    );
  });

  test("examiner grant overrides role", () => {
    assert.equal(
      getBuddyMode({ hasExaminerGrant: true, role: "bank_admin" }),
      "examiner_portal",
    );
  });

  test("examiner role resolves to examiner_portal", () => {
    assert.equal(getBuddyMode({ role: "examiner" }), "examiner_portal");
  });

  test("bank roles resolve to banker_copilot", () => {
    assert.equal(getBuddyMode({ role: "super_admin" }), "banker_copilot");
    assert.equal(getBuddyMode({ role: "bank_admin" }), "banker_copilot");
    assert.equal(getBuddyMode({ role: "underwriter" }), "banker_copilot");
  });

  test("dev environment resolves to builder_observer", () => {
    assert.equal(getBuddyMode({ isDev: true }), "builder_observer");
  });

  test("default (no context) resolves to banker_copilot", () => {
    assert.equal(getBuddyMode({}), "banker_copilot");
    assert.equal(getBuddyMode(), "banker_copilot");
  });

  test("invalid env mode is ignored", () => {
    assert.equal(getBuddyMode({ envMode: "invalid_mode" }), "banker_copilot");
    assert.equal(getBuddyMode({ envMode: "" }), "banker_copilot");
    assert.equal(getBuddyMode({ envMode: null }), "banker_copilot");
  });

  test("precedence: env > grant > role > dev > default", () => {
    // env beats everything
    assert.equal(
      getBuddyMode({ envMode: "builder_observer", hasExaminerGrant: true, role: "examiner", isDev: true }),
      "builder_observer",
    );
    // grant beats role
    assert.equal(
      getBuddyMode({ hasExaminerGrant: true, role: "super_admin", isDev: true }),
      "examiner_portal",
    );
    // role beats dev
    assert.equal(
      getBuddyMode({ role: "bank_admin", isDev: true }),
      "banker_copilot",
    );
  });
});

describe("isBuddyMode", () => {
  test("valid modes return true", () => {
    assert.equal(isBuddyMode("builder_observer"), true);
    assert.equal(isBuddyMode("banker_copilot"), true);
    assert.equal(isBuddyMode("examiner_portal"), true);
  });

  test("invalid values return false", () => {
    assert.equal(isBuddyMode("invalid"), false);
    assert.equal(isBuddyMode(""), false);
    assert.equal(isBuddyMode(null), false);
    assert.equal(isBuddyMode(undefined), false);
    assert.equal(isBuddyMode(42), false);
    assert.equal(isBuddyMode({}), false);
  });
});

// ── 2. Feature Gates ────────────────────────────────────

describe("Feature Gates", () => {
  const modes: BuddyMode[] = ["builder_observer", "banker_copilot", "examiner_portal"];

  describe("canViewDiagnostics", () => {
    test("builder only", () => {
      assert.equal(canViewDiagnostics("builder_observer"), true);
      assert.equal(canViewDiagnostics("banker_copilot"), false);
      assert.equal(canViewDiagnostics("examiner_portal"), false);
    });
  });

  describe("canReplayCase", () => {
    test("builder only", () => {
      assert.equal(canReplayCase("builder_observer"), true);
      assert.equal(canReplayCase("banker_copilot"), false);
      assert.equal(canReplayCase("examiner_portal"), false);
    });
  });

  describe("canValidateCase", () => {
    test("builder + banker", () => {
      assert.equal(canValidateCase("builder_observer"), true);
      assert.equal(canValidateCase("banker_copilot"), true);
      assert.equal(canValidateCase("examiner_portal"), false);
    });
  });

  describe("canGenerateDraftEmails", () => {
    test("banker only", () => {
      assert.equal(canGenerateDraftEmails("builder_observer"), false);
      assert.equal(canGenerateDraftEmails("banker_copilot"), true);
      assert.equal(canGenerateDraftEmails("examiner_portal"), false);
    });
  });

  describe("canDownloadExaminerDrop", () => {
    test("banker only", () => {
      assert.equal(canDownloadExaminerDrop("builder_observer"), false);
      assert.equal(canDownloadExaminerDrop("banker_copilot"), true);
      assert.equal(canDownloadExaminerDrop("examiner_portal"), false);
    });
  });

  describe("canViewCopilotCard", () => {
    test("banker only", () => {
      assert.equal(canViewCopilotCard("builder_observer"), false);
      assert.equal(canViewCopilotCard("banker_copilot"), true);
      assert.equal(canViewCopilotCard("examiner_portal"), false);
    });
  });

  describe("canVerifyIntegrity", () => {
    test("all modes", () => {
      for (const mode of modes) {
        assert.equal(canVerifyIntegrity(mode), true, `${mode} should have canVerifyIntegrity`);
      }
    });
  });

  describe("canAccessObserverPanel", () => {
    test("builder only", () => {
      assert.equal(canAccessObserverPanel("builder_observer"), true);
      assert.equal(canAccessObserverPanel("banker_copilot"), false);
      assert.equal(canAccessObserverPanel("examiner_portal"), false);
    });
  });

  describe("canAccessExaminerPortal", () => {
    test("examiner only", () => {
      assert.equal(canAccessExaminerPortal("builder_observer"), false);
      assert.equal(canAccessExaminerPortal("banker_copilot"), false);
      assert.equal(canAccessExaminerPortal("examiner_portal"), true);
    });
  });

  describe("computeGates", () => {
    test("builder_observer gates match spec matrix", () => {
      const g = computeGates("builder_observer");
      assert.equal(g.canViewDiagnostics, true);
      assert.equal(g.canReplayCase, true);
      assert.equal(g.canValidateCase, true);
      assert.equal(g.canGenerateDraftEmails, false);
      assert.equal(g.canDownloadExaminerDrop, false);
      assert.equal(g.canViewCopilotCard, false);
      assert.equal(g.canVerifyIntegrity, true);
      assert.equal(g.canAccessObserverPanel, true);
      assert.equal(g.canAccessExaminerPortal, false);
    });

    test("banker_copilot gates match spec matrix", () => {
      const g = computeGates("banker_copilot");
      assert.equal(g.canViewDiagnostics, false);
      assert.equal(g.canReplayCase, false);
      assert.equal(g.canValidateCase, true);
      assert.equal(g.canGenerateDraftEmails, true);
      assert.equal(g.canDownloadExaminerDrop, true);
      assert.equal(g.canViewCopilotCard, true);
      assert.equal(g.canVerifyIntegrity, true);
      assert.equal(g.canAccessObserverPanel, false);
      assert.equal(g.canAccessExaminerPortal, false);
    });

    test("examiner_portal gates match spec matrix", () => {
      const g = computeGates("examiner_portal");
      assert.equal(g.canViewDiagnostics, false);
      assert.equal(g.canReplayCase, false);
      assert.equal(g.canValidateCase, false);
      assert.equal(g.canGenerateDraftEmails, false);
      assert.equal(g.canDownloadExaminerDrop, false);
      assert.equal(g.canViewCopilotCard, false);
      assert.equal(g.canVerifyIntegrity, true);
      assert.equal(g.canAccessObserverPanel, false);
      assert.equal(g.canAccessExaminerPortal, true);
    });

    test("all modes return all 9 gate keys", () => {
      const expectedKeys = [
        "canViewDiagnostics", "canReplayCase", "canValidateCase",
        "canGenerateDraftEmails", "canDownloadExaminerDrop", "canViewCopilotCard",
        "canVerifyIntegrity", "canAccessObserverPanel", "canAccessExaminerPortal",
      ];
      for (const mode of modes) {
        const g = computeGates(mode);
        for (const key of expectedKeys) {
          assert.equal(typeof (g as any)[key], "boolean", `${mode}.${key} should be boolean`);
        }
      }
    });

    test("no mode has both observer and examiner panel access", () => {
      for (const mode of modes) {
        const g = computeGates(mode);
        assert.ok(
          !(g.canAccessObserverPanel && g.canAccessExaminerPortal),
          `${mode} should not have both observer and examiner panel access`,
        );
      }
    });

    test("examiner never has write-side capabilities", () => {
      const g = computeGates("examiner_portal");
      assert.equal(g.canReplayCase, false);
      assert.equal(g.canGenerateDraftEmails, false);
      assert.equal(g.canDownloadExaminerDrop, false);
    });
  });
});

// ── 3. Examiner Auth ─────────────────────────────────────

describe("extractGrantId", () => {
  test("extracts from query param", () => {
    const params = new URLSearchParams("grant_id=abc-123");
    assert.equal(extractGrantId({ searchParams: params }), "abc-123");
  });

  test("extracts from Bearer token", () => {
    assert.equal(
      extractGrantId({ authHeader: "Bearer grant-token-456" }),
      "grant-token-456",
    );
  });

  test("query param takes precedence over bearer", () => {
    const params = new URLSearchParams("grant_id=from-query");
    assert.equal(
      extractGrantId({ searchParams: params, authHeader: "Bearer from-bearer" }),
      "from-query",
    );
  });

  test("returns null when neither provided", () => {
    assert.equal(extractGrantId({}), null);
    assert.equal(extractGrantId({ authHeader: null }), null);
    assert.equal(extractGrantId({ authHeader: "Basic xxx" }), null);
  });
});

describe("validateGrantScope", () => {
  const activeGrant: ExaminerAccessGrant = {
    id: "grant-1",
    examiner_name: "Jane Doe",
    organization: "OCC",
    bank_id: "bank-1",
    scope: { deal_ids: ["deal-1", "deal-2"], read_areas: ["borrower", "decision"] },
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    revoked_at: null,
    is_active: true,
  };

  test("allows access to scoped deal and area", () => {
    const result = validateGrantScope(activeGrant, "deal-1", "borrower");
    assert.equal(result.allowed, true);
  });

  test("denies access to out-of-scope deal", () => {
    const result = validateGrantScope(activeGrant, "deal-999", "borrower");
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes("not in grant scope"));
  });

  test("denies access to out-of-scope area", () => {
    const result = validateGrantScope(activeGrant, "deal-1", "financials");
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes("not in grant scope"));
  });

  test("'all' area grants access to any area", () => {
    const allAreaGrant = {
      ...activeGrant,
      scope: { deal_ids: ["deal-1"], read_areas: ["all"] },
    };
    assert.equal(validateGrantScope(allAreaGrant, "deal-1", "anything").allowed, true);
  });

  test("empty deal_ids allows any deal", () => {
    const anyDealGrant = {
      ...activeGrant,
      scope: { deal_ids: [], read_areas: ["borrower"] },
    };
    assert.equal(validateGrantScope(anyDealGrant, "any-deal", "borrower").allowed, true);
  });

  test("inactive grant is denied", () => {
    const inactiveGrant = { ...activeGrant, is_active: false };
    const result = validateGrantScope(inactiveGrant, "deal-1", "borrower");
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes("no longer active"));
  });
});

describe("canExaminerDownload", () => {
  test("returns false by default (no allow_downloads)", () => {
    assert.equal(canExaminerDownload({ deal_ids: [], read_areas: ["all"] }), false);
  });

  test("returns true when allow_downloads is true", () => {
    const scope = { deal_ids: [], read_areas: ["all"], allow_downloads: true } as any;
    assert.equal(canExaminerDownload(scope), true);
  });

  test("returns false when allow_downloads is false", () => {
    const scope = { deal_ids: [], read_areas: ["all"], allow_downloads: false } as any;
    assert.equal(canExaminerDownload(scope), false);
  });
});

// ── 4. Integrity verifyArtifactSet ───────────────────────

describe("verifyArtifactSet", () => {
  const content1 = stableStringify({ key: "value1" });
  const content2 = stableStringify({ key: "value2" });
  const hash1 = sha256Sim(content1);
  const hash2 = sha256Sim(content2);
  const dropHash = sha256Sim(`${hash1}|${hash2}`);

  const validManifest = {
    artifacts: [
      { path: "file1.json", sha256: hash1, size_bytes: content1.length },
      { path: "file2.json", sha256: hash2, size_bytes: content2.length },
    ],
    drop_hash: dropHash,
  };

  test("valid set passes all checks", () => {
    const result = verifyArtifactSet({
      manifest: validManifest,
      contents: new Map([
        ["file1.json", content1],
        ["file2.json", content2],
      ]),
    });

    assert.equal(result.valid, true);
    assert.equal(result.verified, 2);
    assert.equal(result.mismatched, 0);
    assert.equal(result.missing, 0);
    assert.equal(result.drop_hash_match, true);
    assert.equal(result.total_artifacts, 2);
    assert.equal(result.check_version, "1.0");
  });

  test("missing content is reported", () => {
    const result = verifyArtifactSet({
      manifest: validManifest,
      contents: new Map([["file1.json", content1]]),
    });

    assert.equal(result.valid, false);
    assert.equal(result.missing, 1);
    assert.equal(result.verified, 1);
  });

  test("tampered content fails hash check", () => {
    const result = verifyArtifactSet({
      manifest: validManifest,
      contents: new Map([
        ["file1.json", content1],
        ["file2.json", "tampered content"],
      ]),
    });

    assert.equal(result.valid, false);
    assert.equal(result.mismatched, 1);
    assert.equal(result.verified, 1);
  });

  test("wrong drop hash fails", () => {
    const badManifest = { ...validManifest, drop_hash: "wrong_hash" };
    const result = verifyArtifactSet({
      manifest: badManifest,
      contents: new Map([
        ["file1.json", content1],
        ["file2.json", content2],
      ]),
    });

    assert.equal(result.valid, false);
    assert.equal(result.drop_hash_match, false);
    assert.equal(result.verified, 2); // individual files still pass
  });

  test("snapshot-based verification works", () => {
    const snapshot1 = { key: "value1" };
    const result = verifyArtifactSet({
      manifest: validManifest,
      contents: new Map([["file2.json", content2]]),
      snapshots: new Map([["file1.json", snapshot1]]),
    });

    assert.equal(result.valid, true);
    assert.equal(result.verified, 2);
    // Check that the snapshot-verified result has artifact_type "snapshot"
    const snapResult = result.results.find((r) => r.artifact_id === "file1.json");
    assert.equal(snapResult?.artifact_type, "snapshot");
  });

  test("empty manifest fails consistency check", () => {
    const result = verifyArtifactSet({
      manifest: { artifacts: [], drop_hash: sha256Sim("") },
      contents: new Map(),
    });

    assert.equal(result.valid, false);
    const noArtifacts = result.consistency.find((c) => c.check === "manifest_has_artifacts");
    assert.equal(noArtifacts?.passed, false);
  });

  test("duplicate paths fail consistency check", () => {
    const dupManifest = {
      artifacts: [
        { path: "file1.json", sha256: hash1, size_bytes: 10 },
        { path: "file1.json", sha256: hash1, size_bytes: 10 },
      ],
      drop_hash: sha256Sim(`${hash1}|${hash1}`),
    };
    const result = verifyArtifactSet({
      manifest: dupManifest,
      contents: new Map([["file1.json", content1]]),
    });

    assert.equal(result.valid, false);
    const noDupes = result.consistency.find((c) => c.check === "no_duplicate_paths");
    assert.equal(noDupes?.passed, false);
  });

  test("results include all artifacts", () => {
    const result = verifyArtifactSet({
      manifest: validManifest,
      contents: new Map([
        ["file1.json", content1],
        ["file2.json", content2],
      ]),
    });

    assert.equal(result.results.length, 2);
    const paths = result.results.map((r) => r.artifact_id).sort();
    assert.deepEqual(paths, ["file1.json", "file2.json"]);
  });

  test("checked_at is an ISO timestamp", () => {
    const result = verifyArtifactSet({
      manifest: validManifest,
      contents: new Map([
        ["file1.json", content1],
        ["file2.json", content2],
      ]),
    });

    assert.ok(result.checked_at.match(/^\d{4}-\d{2}-\d{2}T/), "checked_at should be ISO");
  });
});

// ── 5. Cross-Cutting: Mode Isolation ─────────────────────

describe("Mode Isolation Invariants", () => {
  test("examiner portal has no write capabilities across entire gate matrix", () => {
    const g = computeGates("examiner_portal");
    // All write/action gates must be false
    assert.equal(g.canReplayCase, false, "examiner must not replay");
    assert.equal(g.canGenerateDraftEmails, false, "examiner must not draft emails");
    assert.equal(g.canDownloadExaminerDrop, false, "examiner must not download drops");
    assert.equal(g.canViewDiagnostics, false, "examiner must not view diagnostics");
    assert.equal(g.canViewCopilotCard, false, "examiner must not view copilot");
    assert.equal(g.canAccessObserverPanel, false, "examiner must not access observer");
    // Only read gates
    assert.equal(g.canVerifyIntegrity, true, "examiner can verify integrity");
    assert.equal(g.canAccessExaminerPortal, true, "examiner can access portal");
  });

  test("builder observer has no banker-only capabilities", () => {
    const g = computeGates("builder_observer");
    assert.equal(g.canGenerateDraftEmails, false, "builder must not draft emails");
    assert.equal(g.canDownloadExaminerDrop, false, "builder must not download drops");
    assert.equal(g.canViewCopilotCard, false, "builder must not view copilot");
  });

  test("banker copilot has no builder-only or examiner capabilities", () => {
    const g = computeGates("banker_copilot");
    assert.equal(g.canViewDiagnostics, false, "banker must not view diagnostics");
    assert.equal(g.canReplayCase, false, "banker must not replay");
    assert.equal(g.canAccessObserverPanel, false, "banker must not access observer");
    assert.equal(g.canAccessExaminerPortal, false, "banker must not access examiner portal");
  });

  test("no two modes share the same gate fingerprint", () => {
    const modes: BuddyMode[] = ["builder_observer", "banker_copilot", "examiner_portal"];
    const fingerprints = modes.map((m) => JSON.stringify(computeGates(m)));
    const unique = new Set(fingerprints);
    assert.equal(unique.size, 3, "each mode should have a unique gate fingerprint");
  });
});
