import "server-only";

/**
 * POST /api/governance/export
 *
 * Generates the "AI Governance Pack" — a single PDF containing:
 *   1. AI Risk Assessment (Use Case Registry)
 *   2. Validation Summary (mission stats)
 *   3. Monitoring & Drift Report (failures, anomalies)
 *   4. Audit Appendix (ledger events, correlation IDs)
 *
 * Sealed endpoint: always HTTP 200, errors in body.
 */

import { NextResponse, NextRequest } from "next/server";
import PDFDocument from "pdfkit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/governance/export";

export async function POST(req: NextRequest) {
  const correlationId = generateCorrelationId("govex");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // ── Gather data ──────────────────────────────────────
    const [
      { data: useCases },
      { data: recentMissions },
      { data: ledgerEvents },
      { data: attestationPolicy },
      { data: committeePolicy },
    ] = await Promise.all([
      sb.from("buddy_ai_use_cases").select("*").order("mission_type"),
      sb.from("buddy_research_missions")
        .select("id, mission_type, status, deal_id, created_at, completed_at")
        .eq("bank_id", bankId)
        .order("created_at", { ascending: false })
        .limit(100),
      sb.from("deal_pipeline_ledger")
        .select("id, deal_id, event_key, status, ui_message, meta, created_at")
        .eq("bank_id", bankId)
        .like("event_key", "buddy.%")
        .order("created_at", { ascending: false })
        .limit(50),
      sb.from("bank_attestation_policies").select("*").eq("bank_id", bankId).maybeSingle(),
      sb.from("bank_credit_committee_policies").select("*").eq("bank_id", bankId).maybeSingle(),
    ]);

    const missions = recentMissions ?? [];
    const completedCount = missions.filter((m: any) => m.status === "complete").length;
    const failedCount = missions.filter((m: any) => m.status === "failed").length;
    const events = ledgerEvents ?? [];
    const cases = useCases ?? [];

    // ── Generate PDF ─────────────────────────────────────
    const pdfBuffer = await generateGovernancePDF({
      bankId,
      useCases: cases,
      missions,
      completedCount,
      failedCount,
      events,
      attestationPolicy,
      committeePolicy,
      timestamp: ts,
      correlationId,
    });

    // ── Ledger event ─────────────────────────────────────
    logLedgerEvent({
      dealId: "governance",
      bankId,
      eventKey: "buddy.ai.governance_pack_generated",
      uiState: "done",
      uiMessage: "AI Governance Pack exported",
      meta: { correlationId, format: "pdf", useCaseCount: cases.length, missionCount: missions.length },
    }).catch(() => {});

    const filename = `AI-Governance-Pack-${ts.slice(0, 10)}.pdf`;

    return respond200(
      {
        ok: true,
        data: pdfBuffer.toString("base64"),
        filename,
        contentType: "application/pdf",
        meta: { bankId, correlationId, ts },
      },
      headers
    );
  } catch (error: unknown) {
    rethrowNextErrors(error);

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: error.code === "not_authenticated" ? 401 : 403 },
      );
    }

    const safe = sanitizeError(error, "governance_export_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers
    );
  }
}

// ============================================================================
// PDF Generation
// ============================================================================

type GovernancePDFInput = {
  bankId: string;
  useCases: any[];
  missions: any[];
  completedCount: number;
  failedCount: number;
  events: any[];
  attestationPolicy: any;
  committeePolicy: any;
  timestamp: string;
  correlationId: string;
};

function generateGovernancePDF(input: GovernancePDFInput): Promise<Buffer> {
  const {
    bankId,
    useCases,
    missions,
    completedCount,
    failedCount,
    events,
    attestationPolicy,
    committeePolicy,
    timestamp,
    correlationId,
  } = input;

  return new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: "LETTER",
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: {
          Title: "AI Governance Pack",
          Author: "Buddy The Underwriter",
          Subject: "AI Governance Report",
          Keywords: "governance, AI, compliance, audit",
          Creator: "Buddy Governance Engine",
          CreationDate: new Date(),
        },
      });

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // ── Title Page ──────────────────────────────────────
      doc.fontSize(28).font("Helvetica-Bold").text("AI GOVERNANCE PACK", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(16).font("Helvetica").text("Buddy The Underwriter", { align: "center" });
      doc.moveDown(2);

      doc.fontSize(12).fillColor("#666666");
      doc.text(`Generated: ${formatDT(timestamp)}`, { align: "center" });
      doc.text(`Bank ID: ${bankId.slice(0, 8)}...`, { align: "center" });
      doc.text(`Correlation ID: ${correlationId}`, { align: "center" });
      doc.moveDown(2);

      // Summary metrics
      doc.fontSize(14).fillColor("#333333").font("Helvetica-Bold").text("Summary", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(11).font("Helvetica").fillColor("#000000");
      doc.text(`AI Use Cases Registered: ${useCases.length}`, { align: "center" });
      doc.text(`Use Cases Approved: ${useCases.filter((uc: any) => uc.approval_status === "approved").length}`, { align: "center" });
      doc.text(`Use Cases Pending: ${useCases.filter((uc: any) => uc.approval_status === "pending_review").length}`, { align: "center" });
      doc.text(`Total Missions Executed: ${missions.length}`, { align: "center" });
      doc.text(`Completed: ${completedCount} | Failed: ${failedCount}`, { align: "center" });

      doc.addPage();

      // ── Section 1: AI Risk Assessment ───────────────────
      sectionHeader(doc, "1. AI Risk Assessment");
      doc.fontSize(11).font("Helvetica").fillColor("#000000");
      doc.text(
        "The following table lists all AI-driven capabilities registered in the Buddy AI Use Case Registry. " +
        "Each use case has a defined risk tier, automation level, and approval status.",
        { lineGap: 4 }
      );
      doc.moveDown(1);

      // Use case table
      doc.fontSize(10).font("Helvetica-Bold");
      const colWidths = [170, 60, 80, 80, 80];
      const startX = 72;
      let y = doc.y;

      // Header row
      doc.text("Use Case", startX, y, { width: colWidths[0] });
      doc.text("Risk", startX + colWidths[0], y, { width: colWidths[1] });
      doc.text("Automation", startX + colWidths[0] + colWidths[1], y, { width: colWidths[2] });
      doc.text("Approval", startX + colWidths[0] + colWidths[1] + colWidths[2], y, { width: colWidths[3] });

      doc.moveDown(0.5);
      doc.moveTo(startX, doc.y).lineTo(startX + 470, doc.y).stroke("#cccccc");
      doc.moveDown(0.5);

      doc.fontSize(9).font("Helvetica");
      for (const uc of useCases) {
        y = doc.y;
        if (y > 680) { doc.addPage(); y = doc.y; }
        doc.text(uc.name, startX, y, { width: colWidths[0] });
        doc.fillColor(riskColor(uc.risk_tier));
        doc.text(String(uc.risk_tier).toUpperCase(), startX + colWidths[0], y, { width: colWidths[1] });
        doc.fillColor("#000000");
        doc.text(formatAutoLevel(uc.automation_level), startX + colWidths[0] + colWidths[1], y, { width: colWidths[2] });
        doc.fillColor(approvalColor(uc.approval_status));
        doc.text(formatApproval(uc.approval_status), startX + colWidths[0] + colWidths[1] + colWidths[2], y, { width: colWidths[3] });
        doc.fillColor("#000000");
        doc.moveDown(0.8);
      }

      doc.moveDown(1);
      doc.fontSize(9).fillColor("#666666").font("Helvetica-Oblique");
      doc.text(
        "Enforcement Rule: A mission may only auto-run if approval_status = 'approved' AND automation_level = 'auto'. " +
        "Human-in-loop missions require banker approval. Restricted missions are blocked entirely."
      );

      doc.addPage();

      // ── Section 2: Validation Summary ────────────────────
      sectionHeader(doc, "2. Validation Summary");
      doc.fontSize(11).font("Helvetica").fillColor("#000000");
      doc.text(
        "This section summarizes AI mission execution metrics including completion rates, " +
        "failure counts, and distribution across mission types.",
        { lineGap: 4 }
      );
      doc.moveDown(1);

      doc.fontSize(11).font("Helvetica-Bold");
      doc.text(`Total Missions: ${missions.length}`);
      doc.text(`Completed: ${completedCount}`);
      doc.text(`Failed: ${failedCount}`);
      doc.text(`Success Rate: ${missions.length > 0 ? ((completedCount / missions.length) * 100).toFixed(1) : "N/A"}%`);
      doc.moveDown(1);

      // Mission type breakdown
      const typeCounts: Record<string, number> = {};
      for (const m of missions) {
        typeCounts[m.mission_type] = (typeCounts[m.mission_type] || 0) + 1;
      }
      doc.fontSize(10).font("Helvetica-Bold").text("Mission Type Distribution:");
      doc.moveDown(0.3);
      doc.fontSize(9).font("Helvetica");
      for (const [mType, count] of Object.entries(typeCounts).sort(([, a], [, b]) => b - a)) {
        const ucName = useCases.find((uc: any) => uc.mission_type === mType)?.name ?? mType;
        doc.text(`  ${ucName}: ${count} executions`);
      }

      doc.addPage();

      // ── Section 3: Monitoring & Drift Report ─────────────
      sectionHeader(doc, "3. Monitoring & Drift Report");
      doc.fontSize(11).font("Helvetica").fillColor("#000000");
      doc.text(
        "Drift indicators include mission failures, policy changes, and anomalous execution patterns. " +
        "This section highlights any areas requiring governance review.",
        { lineGap: 4 }
      );
      doc.moveDown(1);

      // Attestation & Committee status
      doc.fontSize(10).font("Helvetica-Bold").text("Attestation Policy:");
      doc.fontSize(9).font("Helvetica");
      if (attestationPolicy) {
        doc.text(`  Required attestation count: ${attestationPolicy.required_count}`);
        doc.text(`  Required roles: ${(attestationPolicy.required_roles ?? []).join(", ") || "None specified"}`);
      } else {
        doc.text("  Not configured");
      }
      doc.moveDown(0.5);

      doc.fontSize(10).font("Helvetica-Bold").text("Committee Policy:");
      doc.fontSize(9).font("Helvetica");
      if (committeePolicy) {
        doc.text(`  Status: ${committeePolicy.enabled ? "Enabled" : "Disabled"}`);
        doc.text(`  Rules defined: ${Object.keys(committeePolicy.rules_json || {}).length}`);
      } else {
        doc.text("  Not configured");
      }
      doc.moveDown(0.5);

      // Failed missions
      const failed = missions.filter((m: any) => m.status === "failed");
      if (failed.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#dc2626").text("Failed Missions (Drift Indicators):");
        doc.fontSize(9).font("Helvetica").fillColor("#000000");
        for (const m of failed.slice(0, 10)) {
          doc.text(`  [${formatDT(m.created_at)}] ${m.mission_type} — Deal ${m.deal_id.slice(0, 8)}`);
        }
      } else {
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor("#16a34a").font("Helvetica-Bold").text("No drift indicators detected.");
        doc.fillColor("#000000");
      }

      doc.addPage();

      // ── Section 4: Audit Appendix ────────────────────────
      sectionHeader(doc, "4. Audit Appendix");
      doc.fontSize(11).font("Helvetica").fillColor("#000000");
      doc.text(
        "Complete audit trail of AI-related ledger events with correlation IDs for traceability.",
        { lineGap: 4 }
      );
      doc.moveDown(1);

      if (events.length > 0) {
        doc.fontSize(8).font("Helvetica");
        for (const evt of events) {
          y = doc.y;
          if (y > 700) { doc.addPage(); y = doc.y; }
          const cid = (evt.meta as any)?.correlationId?.slice(0, 16) ?? "—";
          doc.text(
            `[${formatDT(evt.created_at)}] ${evt.event_key} | ${evt.ui_message ?? ""} | cid: ${cid}`,
            { lineGap: 2 }
          );
        }
      } else {
        doc.text("No AI-related events recorded.");
      }

      // ── Footers ─────────────────────────────────────────
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor("#999999");
        doc.text(
          `Page ${i + 1} of ${pageCount} | AI Governance Pack | ${formatDT(timestamp)} | ${correlationId}`,
          72,
          doc.page.height - 50,
          { align: "center", width: doc.page.width - 144 }
        );
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================================
// Helpers
// ============================================================================

function sectionHeader(doc: PDFKit.PDFDocument, title: string) {
  doc.fontSize(16).fillColor("#333333").font("Helvetica-Bold");
  doc.text(title, { underline: true });
  doc.moveDown(0.5);
}

function formatDT(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", timeZoneName: "short",
    });
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

function riskColor(tier: string): string {
  switch (tier) { case "high": return "#dc2626"; case "medium": return "#d97706"; default: return "#16a34a"; }
}

function approvalColor(status: string): string {
  switch (status) { case "approved": return "#16a34a"; case "restricted": return "#dc2626"; default: return "#d97706"; }
}

function formatAutoLevel(level: string): string {
  switch (level) { case "auto": return "Auto"; case "human_in_loop": return "Human-in-Loop"; case "restricted": return "Restricted"; default: return level; }
}

function formatApproval(status: string): string {
  switch (status) { case "approved": return "Approved"; case "pending_review": return "Pending Review"; case "restricted": return "Restricted"; default: return status; }
}
