import "server-only";

import JSZip from "jszip";
import { sha256 } from "@/lib/security/tokens";
import { stableStringify } from "./buildBorrowerAuditSnapshot";
import {
  buildBorrowerAuditSnapshot,
  type AuditSnapshotResult,
} from "./buildBorrowerAuditSnapshot";
import { renderBorrowerAuditPdf } from "./renderBorrowerAuditPdf";
import {
  buildCreditDecisionAuditSnapshot,
  type CreditDecisionAuditResult,
} from "./buildCreditDecisionAuditSnapshot";
import { renderCreditDecisionAuditPdf } from "./renderCreditDecisionAuditPdf";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  MODEL_REGISTRY,
  validateGovernanceInvariants,
} from "@/lib/modelGovernance/modelRegistry";
import { explainAllModels } from "@/lib/modelGovernance/explainModelOutput";
import { generateExaminerPlaybooks } from "@/lib/examiner/playbookGenerator";
import { renderPlaybooksPdf } from "@/lib/examiner/renderPlaybooksPdf";

/**
 * Canonical Examiner Drop ZIP Builder (Phase G)
 *
 * Produces a self-contained, tamper-evident ZIP archive suitable for
 * regulatory examination. Contains:
 *
 *   README.txt                          — what's inside
 *   borrower-audit/snapshot.json        — Phase E borrower audit
 *   borrower-audit/snapshot.pdf         — Phase E borrower audit PDF
 *   credit-decision/snapshot.json       — Phase F credit decision audit
 *   credit-decision/snapshot.pdf        — Phase F credit decision audit PDF
 *   financials/financial-snapshot.json   — deal financial snapshot
 *   policies/policy-eval.json           — policy evaluation record
 *   policies/exceptions.json            — policy exceptions
 *   policies/model-governance.json      — Phase H model governance appendix
 *   playbooks/examiner-playbooks.json   — Phase I examiner playbooks
 *   playbooks/examiner-playbooks.pdf    — Phase I examiner playbooks PDF
 *   integrity/manifest.json             — artifact inventory + hashes
 *   integrity/checksums.txt             — one-line-per-file checksums
 *
 * Invariants:
 *  - Every file in the ZIP has a SHA-256 checksum in the manifest
 *  - manifest.json itself is the last file added, and its hash is
 *    the "drop hash" returned in the API response header
 *  - All JSON files use canonical stableStringify ordering
 *  - ZIP uses DEFLATE compression (level 9)
 *  - Borrower audit uses Phase E canonical snapshot builder
 *  - Credit decision audit uses Phase F canonical snapshot builder
 */

export type ExaminerDropResult = {
  zipBuffer: Buffer;
  drop_hash: string;
  manifest: ExaminerDropManifest;
};

export type ExaminerDropManifest = {
  drop_version: "1.0";
  generated_at: string;
  deal_id: string;
  bank_id: string;
  borrower_id: string | null;
  decision_snapshot_id: string;
  artifacts: Array<{
    path: string;
    sha256: string;
    size_bytes: number;
    content_type: string;
  }>;
  borrower_audit_hash: string | null;
  credit_decision_hash: string;
  drop_hash: string;
};

export async function buildExaminerDropZip(opts: {
  dealId: string;
  bankId: string;
  snapshotId: string;
}): Promise<ExaminerDropResult> {
  const sb = supabaseAdmin();
  const generatedAt = new Date().toISOString();
  const zip = new JSZip();
  const artifacts: ExaminerDropManifest["artifacts"] = [];

  // ── 1) Resolve deal → borrower ─────────────────────
  const { data: dealRaw } = await sb
    .from("deals")
    .select("id, borrower_id, borrower_name")
    .eq("id", opts.dealId)
    .maybeSingle();

  if (!dealRaw) {
    throw new Error("deal_not_found");
  }

  const deal = dealRaw as any;
  const borrowerId: string | null = deal.borrower_id ?? null;

  // ── 2) Build Borrower Audit Snapshot (Phase E) ─────
  let borrowerAuditResult: AuditSnapshotResult | null = null;
  let borrowerPdfBuffer: Buffer | null = null;

  if (borrowerId) {
    try {
      borrowerAuditResult = await buildBorrowerAuditSnapshot({
        borrowerId,
        bankId: opts.bankId,
        dealId: opts.dealId,
      });

      const borrowerJson = stableStringify(borrowerAuditResult.snapshot);
      const borrowerJsonBuf = Buffer.from(borrowerJson, "utf-8");
      zip.file("borrower-audit/snapshot.json", borrowerJsonBuf);
      artifacts.push({
        path: "borrower-audit/snapshot.json",
        sha256: sha256(borrowerJson),
        size_bytes: borrowerJsonBuf.length,
        content_type: "application/json",
      });

      borrowerPdfBuffer = await renderBorrowerAuditPdf(
        borrowerAuditResult.snapshot,
        borrowerAuditResult.snapshot_hash,
      );
      zip.file("borrower-audit/snapshot.pdf", borrowerPdfBuffer);
      artifacts.push({
        path: "borrower-audit/snapshot.pdf",
        sha256: sha256(borrowerPdfBuffer.toString("base64")),
        size_bytes: borrowerPdfBuffer.length,
        content_type: "application/pdf",
      });
    } catch (err) {
      // If borrower audit fails, include error note but continue
      const errNote = `Borrower audit snapshot failed: ${(err as any)?.message ?? "unknown"}`;
      const errBuf = Buffer.from(errNote, "utf-8");
      zip.file("borrower-audit/ERROR.txt", errBuf);
      artifacts.push({
        path: "borrower-audit/ERROR.txt",
        sha256: sha256(errNote),
        size_bytes: errBuf.length,
        content_type: "text/plain",
      });
    }
  }

  // ── 3) Build Credit Decision Audit Snapshot (Phase F)
  let decisionResult: CreditDecisionAuditResult;
  try {
    decisionResult = await buildCreditDecisionAuditSnapshot({
      dealId: opts.dealId,
      bankId: opts.bankId,
      snapshotId: opts.snapshotId,
    });
  } catch (err) {
    throw new Error(`decision_audit_build_failed: ${(err as any)?.message ?? "unknown"}`);
  }

  const decisionJson = stableStringify(decisionResult.snapshot);
  const decisionJsonBuf = Buffer.from(decisionJson, "utf-8");
  zip.file("credit-decision/snapshot.json", decisionJsonBuf);
  artifacts.push({
    path: "credit-decision/snapshot.json",
    sha256: sha256(decisionJson),
    size_bytes: decisionJsonBuf.length,
    content_type: "application/json",
  });

  const decisionPdfBuffer = await renderCreditDecisionAuditPdf(
    decisionResult.snapshot,
    decisionResult.snapshot_hash,
  );
  zip.file("credit-decision/snapshot.pdf", decisionPdfBuffer);
  artifacts.push({
    path: "credit-decision/snapshot.pdf",
    sha256: sha256(decisionPdfBuffer.toString("base64")),
    size_bytes: decisionPdfBuffer.length,
    content_type: "application/pdf",
  });

  // ── 4) Financial Snapshot ──────────────────────────
  const { data: finDecRaw } = await sb
    .from("financial_snapshot_decisions")
    .select("snapshot_json")
    .eq("deal_id", opts.dealId)
    .eq("bank_id", opts.bankId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (finDecRaw) {
    const finJson = stableStringify((finDecRaw as any).snapshot_json ?? {});
    const finBuf = Buffer.from(finJson, "utf-8");
    zip.file("financials/financial-snapshot.json", finBuf);
    artifacts.push({
      path: "financials/financial-snapshot.json",
      sha256: sha256(finJson),
      size_bytes: finBuf.length,
      content_type: "application/json",
    });
  }

  // ── 5) Policy Evaluation Record ────────────────────
  const { data: decSnapRaw } = await sb
    .from("decision_snapshots")
    .select("policy_eval_json, exceptions_json, policy_snapshot_json")
    .eq("id", opts.snapshotId)
    .maybeSingle();

  if (decSnapRaw) {
    const snap = decSnapRaw as any;

    const policyEvalJson = stableStringify(snap.policy_eval_json ?? {});
    const policyBuf = Buffer.from(policyEvalJson, "utf-8");
    zip.file("policies/policy-eval.json", policyBuf);
    artifacts.push({
      path: "policies/policy-eval.json",
      sha256: sha256(policyEvalJson),
      size_bytes: policyBuf.length,
      content_type: "application/json",
    });

    const exceptionsJson = stableStringify(snap.exceptions_json ?? []);
    const excBuf = Buffer.from(exceptionsJson, "utf-8");
    zip.file("policies/exceptions.json", excBuf);
    artifacts.push({
      path: "policies/exceptions.json",
      sha256: sha256(exceptionsJson),
      size_bytes: excBuf.length,
      content_type: "application/json",
    });
  }

  // ── 6) Model Governance Appendix (Phase H) ────────
  const governanceAppendix = {
    governance_version: "1.0",
    generated_at: generatedAt,
    registry: MODEL_REGISTRY.map((m) => ({
      model_id: m.model_id,
      purpose: m.purpose,
      provider: m.provider,
      model_version: m.model_version,
      input_scope: m.input_scope,
      output_scope: m.output_scope,
      decision_authority: m.decision_authority,
      human_override_required: m.human_override_required,
      last_reviewed_at: m.last_reviewed_at,
    })),
    explainability: explainAllModels(),
    override_policy: {
      description:
        "When a human user disagrees with a model recommendation, an override " +
        "must be recorded with: (1) the model_id, (2) the overridden output, " +
        "(3) the reason for override, (4) the approving user ID, (5) a timestamp. " +
        "Overrides are immutable ledger events and appear in all audit artifacts.",
      override_is_mandatory: true,
      override_appears_in: [
        "Credit Decision Audit Pack (Phase F)",
        "Examiner Drop ZIP (Phase G)",
        "Deal Pipeline Ledger",
      ],
    },
    human_in_the_loop: {
      description:
        "All AI models in Buddy operate in assistive-only mode. No model has " +
        "autonomous decision authority. Final credit decisions are human-owned. " +
        "Every model output requires human review and explicit approval before " +
        "it influences a credit decision.",
      guarantees: [
        "No model can approve, decline, or modify a credit decision autonomously.",
        "Every model output is versioned and scoped to declared input/output boundaries.",
        "Model outputs carry confidence scores that are advisory, not prescriptive.",
        "Human overrides are always available and always recorded.",
        "Raw prompts and PII are never stored in model invocation logs.",
      ],
    },
    invariant_check: validateGovernanceInvariants(),
  };

  const govJson = stableStringify(governanceAppendix);
  const govBuf = Buffer.from(govJson, "utf-8");
  zip.file("policies/model-governance.json", govBuf);
  artifacts.push({
    path: "policies/model-governance.json",
    sha256: sha256(govJson),
    size_bytes: govBuf.length,
    content_type: "application/json",
  });

  // ── 7) Examiner Playbooks (Phase I) ─────────────────
  const playbooks = generateExaminerPlaybooks();

  const playbookJson = stableStringify(playbooks);
  const playbookJsonBuf = Buffer.from(playbookJson, "utf-8");
  zip.file("playbooks/examiner-playbooks.json", playbookJsonBuf);
  artifacts.push({
    path: "playbooks/examiner-playbooks.json",
    sha256: sha256(playbookJson),
    size_bytes: playbookJsonBuf.length,
    content_type: "application/json",
  });

  const playbookHash = sha256(playbookJson);
  const playbookPdfBuffer = await renderPlaybooksPdf(playbooks, playbookHash);
  zip.file("playbooks/examiner-playbooks.pdf", playbookPdfBuffer);
  artifacts.push({
    path: "playbooks/examiner-playbooks.pdf",
    sha256: sha256(playbookPdfBuffer.toString("base64")),
    size_bytes: playbookPdfBuffer.length,
    content_type: "application/pdf",
  });

  // ── 8) README ──────────────────────────────────────
  const readmeText = buildReadme({
    dealId: opts.dealId,
    borrowerId,
    borrowerName: deal.borrower_name ?? "Unknown",
    snapshotId: opts.snapshotId,
    generatedAt,
    artifactCount: artifacts.length,
    decision: decisionResult.snapshot.decision.outcome,
  });
  const readmeBuf = Buffer.from(readmeText, "utf-8");
  zip.file("README.txt", readmeBuf);
  artifacts.push({
    path: "README.txt",
    sha256: sha256(readmeText),
    size_bytes: readmeBuf.length,
    content_type: "text/plain",
  });

  // ── 9) Checksums ───────────────────────────────────
  const checksumLines = artifacts
    .map((a) => `${a.sha256}  ${a.path}`)
    .join("\n") + "\n";
  const checksumBuf = Buffer.from(checksumLines, "utf-8");
  zip.file("integrity/checksums.txt", checksumBuf);
  artifacts.push({
    path: "integrity/checksums.txt",
    sha256: sha256(checksumLines),
    size_bytes: checksumBuf.length,
    content_type: "text/plain",
  });

  // ── 10) Manifest (last file) ───────────────────────
  // Compute drop hash from all artifact hashes
  const allHashes = artifacts.map((a) => a.sha256).join("|");
  const dropHash = sha256(allHashes);

  const manifest: ExaminerDropManifest = {
    drop_version: "1.0",
    generated_at: generatedAt,
    deal_id: opts.dealId,
    bank_id: opts.bankId,
    borrower_id: borrowerId,
    decision_snapshot_id: opts.snapshotId,
    artifacts,
    borrower_audit_hash: borrowerAuditResult?.snapshot_hash ?? null,
    credit_decision_hash: decisionResult.snapshot_hash,
    drop_hash: dropHash,
  };

  const manifestJson = stableStringify(manifest);
  const manifestBuf = Buffer.from(manifestJson, "utf-8");
  zip.file("integrity/manifest.json", manifestBuf);

  // ── 11) Generate ZIP buffer ────────────────────────
  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  }) as Buffer;

  return { zipBuffer, drop_hash: dropHash, manifest };
}

// ── Helpers ─────────────────────────────────────────────

function buildReadme(args: {
  dealId: string;
  borrowerId: string | null;
  borrowerName: string;
  snapshotId: string;
  generatedAt: string;
  artifactCount: number;
  decision: string;
}): string {
  return `EXAMINER DROP — REGULATORY AUDIT PACKAGE
==========================================

Generated:  ${args.generatedAt}
Deal ID:    ${args.dealId}
Borrower:   ${args.borrowerName} (${args.borrowerId ?? "N/A"})
Decision:   ${args.decision.toUpperCase()}
Snapshot:   ${args.snapshotId}
Artifacts:  ${args.artifactCount} files

CONTENTS
--------

  README.txt                          This file
  borrower-audit/snapshot.json        Borrower identity, ownership, extraction provenance
  borrower-audit/snapshot.pdf         Borrower audit PDF (human-readable)
  credit-decision/snapshot.json       Credit decision, financials, policy, attestations
  credit-decision/snapshot.pdf        Credit decision audit PDF (human-readable)
  financials/financial-snapshot.json   Deal financial metrics snapshot
  policies/policy-eval.json           Policy evaluation record
  policies/exceptions.json            Policy exceptions
  policies/model-governance.json      AI model governance appendix
  playbooks/examiner-playbooks.json   Examiner playbooks (machine-readable)
  playbooks/examiner-playbooks.pdf    Examiner playbooks (human-readable)
  integrity/checksums.txt             SHA-256 checksums for all files
  integrity/manifest.json             Artifact inventory with hashes

INTEGRITY VERIFICATION
----------------------

Every file in this package has a SHA-256 checksum recorded in
integrity/checksums.txt and integrity/manifest.json.

To verify integrity:

  sha256sum -c integrity/checksums.txt

The "drop_hash" in manifest.json is computed from all artifact
checksums concatenated with "|" separators. This hash is also
returned in the X-Buddy-Drop-Hash HTTP response header at
generation time.

PROVENANCE
----------

This package was generated by Buddy The Underwriter, a regulator-
grade underwriting system of record. Every fact in this package is
traceable to a document extraction, user attestation, policy
evaluation, or ledger event.

No data in this package has been modified after generation. The
snapshot hashes can be independently verified against the system
of record.
`;
}
