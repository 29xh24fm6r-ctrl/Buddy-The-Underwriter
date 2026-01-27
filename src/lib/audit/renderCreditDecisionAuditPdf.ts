import PDFDocument from "pdfkit";
import type { CreditDecisionAuditSnapshot } from "./buildCreditDecisionAuditSnapshot";

/**
 * Render a credit decision audit snapshot to a regulator-grade PDF.
 *
 * Sections (fixed order):
 * 1. Decision Summary
 * 2. Financial Metrics
 * 3. Policy Evaluation
 * 4. Human Overrides
 * 5. Attestation Chain
 * 6. Committee Record
 * 7. Ledger Timeline
 * 8. Integrity Statement
 *
 * Footer (every page):
 *   Buddy Credit Decision Audit | Hash: <snapshotHash> | <UTC timestamp>
 */
export function renderCreditDecisionAuditPdf(
  snapshot: CreditDecisionAuditSnapshot,
  snapshotHash: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: "LETTER",
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: {
          Title: `Credit Decision Audit — Deal ${snapshot.meta.deal_id.slice(0, 8)}…`,
          Author: "Buddy The Underwriter",
          Subject: "Credit Decision Audit Export",
          Keywords: "audit, decision, compliance, attestation, committee, policy",
          Creator: "Buddy Audit Engine",
          CreationDate: new Date(),
        },
      });

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const startX = 72;
      const contentWidth = doc.page.width - 144;

      // ── Title Page ──────────────────────────────────────
      doc.fontSize(24).font("Helvetica-Bold").text("CREDIT DECISION AUDIT", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(14).font("Helvetica").text(
        `Deal ${snapshot.meta.deal_id.slice(0, 8)}… — ${snapshot.decision.outcome.toUpperCase()}`,
        { align: "center" },
      );
      doc.moveDown(2);

      doc.fontSize(11).fillColor("#666666");
      doc.text(`Generated: ${formatDT(snapshot.meta.generated_at)}`, { align: "center" });
      doc.text(`As Of: ${formatDT(snapshot.meta.as_of)}`, { align: "center" });
      doc.text(`Decision Snapshot: ${snapshot.meta.snapshot_id.slice(0, 8)}…`, { align: "center" });
      doc.text(`Audit Hash: ${snapshotHash.slice(0, 16)}…`, { align: "center" });
      doc.moveDown(2);

      doc.fontSize(10).fillColor("#999999").font("Helvetica-Oblique");
      doc.text(
        "This document is a tamper-evident audit artifact. Every decision, policy evaluation, " +
        "human override, attestation, and committee vote is traceable. " +
        "The snapshot hash may be independently verified.",
        { align: "center", lineGap: 3 },
      );

      doc.addPage();

      // ── Section 1: Decision Summary ───────────────────
      sectionHeader(doc, "1. Decision Summary");
      doc.fontSize(11).font("Helvetica").fillColor("#000000");

      const d = snapshot.decision;
      const decFields: [string, string][] = [
        ["Outcome", d.outcome || "—"],
        ["Status", d.status || "—"],
        ["Summary", d.summary || "—"],
        ["Confidence", d.confidence !== null ? `${(d.confidence * 100).toFixed(0)}%` : "—"],
        ["Explanation", d.confidence_explanation || "—"],
        ["Created At", d.created_at ? formatDT(d.created_at) : "—"],
        ["Created By", d.created_by_user_id ?? "—"],
      ];

      for (const [label, value] of decFields) {
        doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
        doc.font("Helvetica").text(value);
      }
      doc.moveDown(1);

      // ── Section 2: Financial Metrics ──────────────────
      sectionHeader(doc, "2. Financial Metrics");
      doc.fontSize(11).font("Helvetica").fillColor("#000000");

      const f = snapshot.financials;
      const finFields: [string, string][] = [
        ["DSCR", fmtNum(f.dscr, 2)],
        ["DSCR Stressed (+300bps)", fmtNum(f.dscr_stressed, 2)],
        ["LTV (Gross)", fmtPct(f.ltv_gross)],
        ["LTV (Net)", fmtPct(f.ltv_net)],
        ["NOI (TTM)", fmtCurrency(f.noi_ttm)],
        ["Cash Flow Available", fmtCurrency(f.cash_flow_available)],
        ["Annual Debt Service", fmtCurrency(f.annual_debt_service)],
        ["Collateral Coverage", fmtNum(f.collateral_coverage, 2)],
        ["Completeness", `${f.completeness_pct.toFixed(1)}%`],
        ["As Of Date", f.as_of_date ?? "—"],
      ];

      for (const [label, value] of finFields) {
        doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
        doc.font("Helvetica").text(value);
      }
      doc.moveDown(1);

      // ── Section 3: Policy Evaluation ──────────────────
      doc.addPage();
      sectionHeader(doc, "3. Policy Evaluation");
      doc.fontSize(11).font("Helvetica").fillColor("#000000");

      const p = snapshot.policy;
      doc.font("Helvetica-Bold").text("Rules Evaluated: ", { continued: true });
      doc.font("Helvetica").text(String(p.rules_evaluated));
      doc.font("Helvetica-Bold").text("Rules Passed: ", { continued: true });
      doc.font("Helvetica").fillColor("#16a34a").text(String(p.rules_passed));
      doc.fillColor("#000000");
      doc.font("Helvetica-Bold").text("Rules Failed: ", { continued: true });
      doc.font("Helvetica").fillColor(p.rules_failed > 0 ? "#dc2626" : "#000000").text(String(p.rules_failed));
      doc.fillColor("#000000");
      doc.moveDown(0.5);

      if (p.exceptions.length > 0) {
        doc.font("Helvetica-Bold").text("Policy Exceptions:");
        doc.moveDown(0.3);

        doc.fontSize(10).font("Helvetica-Bold");
        const eColW = [150, 80, 230];
        let y = doc.y;
        doc.text("Rule Key", startX, y, { width: eColW[0] });
        doc.text("Severity", startX + eColW[0], y, { width: eColW[1] });
        doc.text("Reason", startX + eColW[0] + eColW[1], y, { width: eColW[2] });
        doc.moveDown(0.5);
        doc.moveTo(startX, doc.y).lineTo(startX + 460, doc.y).stroke("#cccccc");
        doc.moveDown(0.5);

        doc.fontSize(9).font("Helvetica");
        for (const ex of p.exceptions) {
          y = doc.y;
          if (y > 680) { doc.addPage(); y = doc.y; }
          doc.text(ex.rule_key || "—", startX, y, { width: eColW[0] });
          const sevColor = ex.severity === "critical" ? "#dc2626" : ex.severity === "warning" ? "#d97706" : "#666666";
          doc.fillColor(sevColor).text(ex.severity, startX + eColW[0], y, { width: eColW[1] });
          doc.fillColor("#000000").text(ex.reason || "—", startX + eColW[0] + eColW[1], y, { width: eColW[2] });
          doc.moveDown(0.8);
        }
      } else {
        doc.text("No policy exceptions recorded.");
      }
      doc.moveDown(1);

      // ── Section 4: Human Overrides ────────────────────
      sectionHeader(doc, "4. Human Overrides");

      if (snapshot.overrides.length > 0) {
        doc.fontSize(10).font("Helvetica");
        for (const ov of snapshot.overrides) {
          const y = doc.y;
          if (y > 660) { doc.addPage(); }
          doc.font("Helvetica-Bold").text(`Field: ${ov.field_path}`);
          doc.font("Helvetica").text(`  Old: ${ov.old_value ?? "—"} → New: ${ov.new_value ?? "—"}`);
          doc.text(`  Reason: ${ov.reason}`);
          doc.text(`  Justification: ${ov.justification}`);
          doc.text(`  Severity: ${ov.severity} | By: ${ov.created_by_user_id} | At: ${formatDT(ov.created_at)}`);
          doc.moveDown(0.5);
        }
      } else {
        doc.fontSize(10).font("Helvetica").text("No human overrides recorded.");
      }
      doc.moveDown(1);

      // ── Section 5: Attestation Chain ──────────────────
      doc.addPage();
      sectionHeader(doc, "5. Attestation Chain");

      if (snapshot.attestations.length > 0) {
        doc.fontSize(10).font("Helvetica-Bold");
        const aColW = [130, 90, 100, 140];
        let y = doc.y;
        doc.text("User", startX, y, { width: aColW[0] });
        doc.text("Role", startX + aColW[0], y, { width: aColW[1] });
        doc.text("Date", startX + aColW[0] + aColW[1], y, { width: aColW[2] });
        doc.text("Hash (trunc)", startX + aColW[0] + aColW[1] + aColW[2], y, { width: aColW[3] });
        doc.moveDown(0.5);
        doc.moveTo(startX, doc.y).lineTo(startX + 460, doc.y).stroke("#cccccc");
        doc.moveDown(0.5);

        doc.fontSize(9).font("Helvetica");
        for (const att of snapshot.attestations) {
          y = doc.y;
          if (y > 680) { doc.addPage(); y = doc.y; }
          doc.text(att.attested_by_name ?? att.attested_by_user_id, startX, y, { width: aColW[0] });
          doc.text(att.attested_role, startX + aColW[0], y, { width: aColW[1] });
          doc.text(formatDT(att.created_at), startX + aColW[0] + aColW[1], y, { width: aColW[2] });
          doc.font("Courier").fontSize(7).text(
            att.snapshot_hash ? att.snapshot_hash.slice(0, 16) + "…" : "—",
            startX + aColW[0] + aColW[1] + aColW[2], y, { width: aColW[3] },
          );
          doc.font("Helvetica").fontSize(9);
          doc.moveDown(0.8);
        }

        // Print statements
        doc.moveDown(0.5);
        doc.font("Helvetica-Bold").fontSize(10).text("Attestation Statements:");
        doc.moveDown(0.3);
        for (const att of snapshot.attestations) {
          doc.fontSize(9).font("Helvetica-Oblique").fillColor("#333333");
          doc.text(`"${att.statement}" — ${att.attested_by_name ?? att.attested_by_user_id} (${att.attested_role})`);
          doc.moveDown(0.3);
        }
        doc.fillColor("#000000");
      } else {
        doc.fontSize(10).font("Helvetica").text("No attestations recorded.");
      }
      doc.moveDown(1);

      // ── Section 6: Committee Record ───────────────────
      doc.addPage();
      sectionHeader(doc, "6. Committee Record");
      doc.fontSize(11).font("Helvetica").fillColor("#000000");

      const c = snapshot.committee;
      doc.font("Helvetica-Bold").text("Quorum: ", { continued: true });
      doc.font("Helvetica").text(String(c.quorum));
      doc.font("Helvetica-Bold").text("Votes Cast: ", { continued: true });
      doc.font("Helvetica").text(String(c.vote_count));
      doc.font("Helvetica-Bold").text("Outcome: ", { continued: true });
      const outcomeColor = c.outcome === "approve" ? "#16a34a"
        : c.outcome === "decline" ? "#dc2626"
        : c.outcome === "approve_with_conditions" ? "#d97706"
        : "#666666";
      doc.font("Helvetica-Bold").fillColor(outcomeColor).text(c.outcome.toUpperCase());
      doc.fillColor("#000000");
      doc.font("Helvetica-Bold").text("Complete: ", { continued: true });
      doc.font("Helvetica").text(c.complete ? "Yes" : "No");
      doc.moveDown(0.5);

      if (c.votes.length > 0) {
        doc.font("Helvetica-Bold").fontSize(10).text("Votes:");
        doc.moveDown(0.3);
        doc.fontSize(9).font("Helvetica");
        for (const v of c.votes) {
          const vColor = v.vote === "approve" ? "#16a34a" : v.vote === "decline" ? "#dc2626" : "#d97706";
          doc.text(`  ${v.voter_name ?? v.voter_user_id}: `, { continued: true });
          doc.fillColor(vColor).text(v.vote, { continued: true });
          doc.fillColor("#000000").text(v.comment ? ` — "${v.comment}"` : "");
        }
        doc.moveDown(0.5);
      }

      if (c.dissent.length > 0) {
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#dc2626").text("Dissenting Opinions:");
        doc.fillColor("#000000").moveDown(0.3);
        doc.fontSize(9).font("Helvetica");
        for (const dis of c.dissent) {
          doc.text(`  ${dis.dissenter_name ?? dis.dissenter_user_id}: "${dis.dissent_reason}" (${formatDT(dis.created_at)})`);
        }
        doc.moveDown(0.5);
      }

      if (c.minutes) {
        doc.font("Helvetica-Bold").fontSize(10).text("Committee Minutes:");
        doc.moveDown(0.3);
        doc.fontSize(9).font("Helvetica").fillColor("#333333");
        // Truncate minutes to prevent PDF from growing unbounded
        const minutesTrunc = c.minutes.length > 4000 ? c.minutes.slice(0, 4000) + "\n…(truncated)" : c.minutes;
        doc.text(minutesTrunc, { lineGap: 2 });
        doc.fillColor("#000000");
        if (c.minutes_hash) {
          doc.moveDown(0.3);
          doc.font("Courier").fontSize(7).text(`Minutes Hash: ${c.minutes_hash}`);
          doc.font("Helvetica");
        }
      }

      doc.moveDown(1);

      // ── Section 7: Ledger Timeline ────────────────────
      doc.addPage();
      sectionHeader(doc, "7. Ledger Timeline");

      if (snapshot.ledger_events.length > 0) {
        doc.fontSize(9).font("Helvetica");
        for (const ev of snapshot.ledger_events.slice(0, 50)) {
          const y = doc.y;
          if (y > 700) { doc.addPage(); }
          doc.text(`[${formatDT(ev.created_at)}] ${ev.type}`);
        }
        if (snapshot.ledger_events.length > 50) {
          doc.moveDown(0.3);
          doc.fillColor("#999999").text(`…and ${snapshot.ledger_events.length - 50} more events`);
          doc.fillColor("#000000");
        }
      } else {
        doc.fontSize(10).font("Helvetica").text("No decision-related ledger events recorded.");
      }
      doc.moveDown(1);

      // ── Section 8: Integrity Statement ────────────────
      doc.addPage();
      sectionHeader(doc, "8. Integrity Statement");

      doc.fontSize(11).font("Helvetica").fillColor("#000000");
      doc.text(
        "This Credit Decision Audit Snapshot is a deterministic export produced by Buddy The Underwriter. " +
        "The snapshot hash below is computed from the canonical JSON representation of all data " +
        "in this document — including decision, financials, policy evaluation, human overrides, " +
        "attestation chain, and committee record — using SHA-256. Any modification to the underlying " +
        "data will produce a different hash.",
        { lineGap: 4 },
      );
      doc.moveDown(1);

      doc.fontSize(12).font("Helvetica-Bold");
      doc.text("Snapshot Hash:");
      doc.moveDown(0.3);
      doc.fontSize(10).font("Courier").fillColor("#333333");
      doc.text(snapshotHash);
      doc.moveDown(1);

      doc.fontSize(10).font("Helvetica").fillColor("#000000");
      doc.text(`Generated: ${formatDT(snapshot.meta.generated_at)}`);
      doc.text(`As Of: ${formatDT(snapshot.meta.as_of)}`);
      doc.text(`Snapshot Version: ${snapshot.meta.snapshot_version}`);
      doc.text(`Deal ID: ${snapshot.meta.deal_id.slice(0, 8)}…`);
      doc.text(`Decision Snapshot ID: ${snapshot.meta.snapshot_id.slice(0, 8)}…`);
      doc.text(`Decision: ${snapshot.decision.outcome}`);
      doc.text(`Status: ${snapshot.decision.status}`);
      doc.text(`Confidence: ${snapshot.decision.confidence !== null ? `${(snapshot.decision.confidence * 100).toFixed(0)}%` : "—"}`);
      doc.text(`Policy Rules: ${snapshot.policy.rules_evaluated} evaluated, ${snapshot.policy.rules_failed} failed`);
      doc.text(`Exceptions: ${snapshot.policy.exceptions.length}`);
      doc.text(`Overrides: ${snapshot.overrides.length}`);
      doc.text(`Attestations: ${snapshot.attestations.length}`);
      doc.text(`Committee Votes: ${snapshot.committee.vote_count}`);
      doc.text(`Committee Outcome: ${snapshot.committee.outcome}`);
      doc.text(`Dissent Opinions: ${snapshot.committee.dissent.length}`);
      doc.text(`Ledger Events: ${snapshot.ledger_events.length}`);

      // ── Page Footers ────────────────────────────────────
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).fillColor("#999999").font("Helvetica");
        doc.text(
          `Page ${i + 1} of ${pageCount} | Buddy Credit Decision Audit | Hash: ${snapshotHash.slice(0, 16)}… | ${formatDT(snapshot.meta.generated_at)}`,
          72,
          doc.page.height - 50,
          { align: "center", width: contentWidth },
        );
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// ── Helpers ──────────────────────────────────────────────

function sectionHeader(doc: PDFKit.PDFDocument, title: string) {
  doc.fontSize(16).fillColor("#333333").font("Helvetica-Bold");
  doc.text(title, { underline: true });
  doc.moveDown(0.5);
}

function formatDT(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return iso.slice(0, 19);
  }
}

function fmtNum(v: number | null, decimals: number): string {
  if (v === null || v === undefined) return "—";
  return v.toFixed(decimals);
}

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtCurrency(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
