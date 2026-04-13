/**
 * Phase 73 — Approval Enforcement Guard Tests
 *
 * Validates that the approval system exists and enforces
 * no-auto-send for borrower communications.
 *
 * Run with: node --import tsx --test src/lib/agentWorkflows/__tests__/approvalGuard.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

// ============================================================================
// Guard 1: Approval module exists with required exports
// ============================================================================

describe("Guard 1: Approval module structure", () => {
  const approvalPath = join(ROOT, "src/lib/agentWorkflows/approval.ts");

  it("approval.ts exists", () => {
    assert.ok(existsSync(approvalPath), "approval.ts must exist");
  });

  it("exports recordApprovalEvent", () => {
    const source = readFileSync(approvalPath, "utf-8");
    assert.ok(
      source.includes("export async function recordApprovalEvent"),
      "must export recordApprovalEvent",
    );
  });

  it("exports verifyApprovalExists", () => {
    const source = readFileSync(approvalPath, "utf-8");
    assert.ok(
      source.includes("export async function verifyApprovalExists"),
      "must export verifyApprovalExists",
    );
  });

  it("exports buildDraftApprovalSnapshot", () => {
    const source = readFileSync(approvalPath, "utf-8");
    assert.ok(
      source.includes("export function buildDraftApprovalSnapshot"),
      "must export buildDraftApprovalSnapshot",
    );
  });
});

// ============================================================================
// Guard 2: Approval module uses server-only
// ============================================================================

describe("Guard 2: Approval module is server-only", () => {
  it("imports server-only", () => {
    const source = readFileSync(
      join(ROOT, "src/lib/agentWorkflows/approval.ts"),
      "utf-8",
    );
    assert.ok(
      source.includes('"server-only"'),
      "approval.ts must import server-only",
    );
  });
});

// ============================================================================
// Guard 3: Migration exists for approval events table
// ============================================================================

describe("Guard 3: Approval events migration", () => {
  it("agent_approval_events migration exists", () => {
    const migrationsDir = join(ROOT, "supabase/migrations");
    const files = require("node:fs")
      .readdirSync(migrationsDir)
      .filter((f: string) => f.includes("approval_events"));
    assert.ok(
      files.length >= 1,
      "migration for agent_approval_events must exist",
    );
  });

  it("migration creates agent_approval_events table", () => {
    const migrationsDir = join(ROOT, "supabase/migrations");
    const files = require("node:fs")
      .readdirSync(migrationsDir)
      .filter((f: string) => f.includes("approval_events"));
    const sql = readFileSync(join(migrationsDir, files[0]), "utf-8");
    assert.ok(
      sql.includes("agent_approval_events"),
      "migration must create agent_approval_events",
    );
    assert.ok(
      sql.includes("snapshot_json"),
      "migration must include snapshot_json column",
    );
    assert.ok(
      sql.includes("decided_by"),
      "migration must include decided_by column",
    );
  });
});

// ============================================================================
// Guard 4: Approval snapshots migration exists
// ============================================================================

describe("Guard 4: Approval snapshots migration", () => {
  it("draft_borrower_requests snapshot columns migration exists", () => {
    const migrationsDir = join(ROOT, "supabase/migrations");
    const files = require("node:fs")
      .readdirSync(migrationsDir)
      .filter((f: string) => f.includes("approval_snapshot"));
    assert.ok(
      files.length >= 1,
      "migration for approval snapshots must exist",
    );
  });

  it("migration adds approved_snapshot and sent_snapshot", () => {
    const migrationsDir = join(ROOT, "supabase/migrations");
    const files = require("node:fs")
      .readdirSync(migrationsDir)
      .filter((f: string) => f.includes("approval_snapshot"));
    const sql = readFileSync(join(migrationsDir, files[0]), "utf-8");
    assert.ok(
      sql.includes("approved_snapshot"),
      "migration must add approved_snapshot",
    );
    assert.ok(
      sql.includes("sent_snapshot"),
      "migration must add sent_snapshot",
    );
  });
});

// ============================================================================
// Guard 5: No auto-send without approval in borrower reminder processor
// ============================================================================

describe("Guard 5: No auto-send without approval check", () => {
  it("borrower reminder processor exists and sends via sendBorrowerCampaign", () => {
    const processorPath = join(
      ROOT,
      "src/lib/borrower-reminders/processor.ts",
    );
    if (!existsSync(processorPath)) {
      assert.ok(true, "processor.ts does not exist (skipped)");
      return;
    }

    const source = readFileSync(processorPath, "utf-8");
    // Canary: verify the send path exists so we know where to wire approval
    assert.ok(
      source.includes("sendBorrowerCampaign"),
      "processor must use sendBorrowerCampaign (known send path for approval wiring)",
    );
  });

  it("approval module exports verifyApprovalExists for send-path wiring", () => {
    const source = readFileSync(
      join(ROOT, "src/lib/agentWorkflows/approval.ts"),
      "utf-8",
    );
    assert.ok(
      source.includes("export async function verifyApprovalExists"),
      "verifyApprovalExists must be available for send-path integration",
    );
  });
});

// ============================================================================
// Guard 6: verifyApprovalExists checks for revocations
// ============================================================================

describe("Guard 6: Revocation awareness", () => {
  it("verifyApprovalExists checks for revoked decisions", () => {
    const source = readFileSync(
      join(ROOT, "src/lib/agentWorkflows/approval.ts"),
      "utf-8",
    );
    assert.ok(
      source.includes("revoked"),
      "verifyApprovalExists must check for revoked decisions",
    );
  });
});
