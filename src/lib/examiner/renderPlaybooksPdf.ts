import PDFDocument from "pdfkit";
import type { ExaminerPlaybooks } from "./playbookGenerator";

/**
 * Render examiner playbooks to a regulator-grade PDF.
 *
 * Sections (fixed order):
 * 1. System Overview
 * 2. Underwriting Flow
 * 3. AI Usage Explanation
 * 4. Borrower Verification
 * 5. Credit Decision Process
 * 6. Override Handling
 * 7. Audit Artifacts Map
 *
 * Footer (every page):
 *   Buddy Examiner Playbook v1.0 | Generated: <UTC timestamp>
 */
export function renderPlaybooksPdf(
  playbooks: ExaminerPlaybooks,
  playbookHash: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: "LETTER",
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: {
          Title: "Examiner Playbook — Buddy The Underwriter",
          Author: "Buddy The Underwriter",
          Subject: "Examiner Playbook Bundle",
          Keywords: "playbook, examiner, audit, compliance, underwriting, governance",
          Creator: "Buddy Audit Engine",
          CreationDate: new Date(),
        },
      });

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const contentWidth = doc.page.width - 144;

      // ── Title Page ──────────────────────────────────────
      doc.fontSize(24).font("Helvetica-Bold").text("EXAMINER PLAYBOOK", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(14).font("Helvetica").text("Buddy The Underwriter", { align: "center" });
      doc.moveDown(2);

      doc.fontSize(11).fillColor("#666666");
      doc.text(`Playbook Version: ${playbooks.playbook_version}`, { align: "center" });
      doc.text(`Generated: ${formatDT(playbooks.generated_at)}`, { align: "center" });
      doc.text(`Hash: ${playbookHash.slice(0, 16)}…`, { align: "center" });
      doc.moveDown(2);

      doc.fontSize(10).fillColor("#999999").font("Helvetica-Oblique");
      doc.text(
        "This document is a comprehensive examiner playbook bundle designed to pre-answer " +
        "regulatory examination questions. Written in plain English, regulator tone, " +
        "zero marketing language. Every section is self-contained.",
        { align: "center", lineGap: 3 },
      );
      doc.moveDown(2);

      // Table of contents
      doc.fontSize(14).fillColor("#333333").font("Helvetica-Bold").text("CONTENTS");
      doc.moveDown(0.5);
      doc.fontSize(11).font("Helvetica").fillColor("#000000");
      const sections = [
        "1. System Overview",
        "2. Underwriting Flow",
        "3. AI Usage Explanation",
        "4. Borrower Verification",
        "5. Credit Decision Process",
        "6. Override Handling",
        "7. Audit Artifacts Map",
      ];
      for (const s of sections) {
        doc.text(s);
      }

      doc.addPage();

      // ── Playbook Sections ────────────────────────────────
      const playbookSections: [string, string][] = [
        ["1. System Overview", playbooks.system_overview],
        ["2. Underwriting Flow", playbooks.underwriting_flow],
        ["3. AI Usage Explanation", playbooks.ai_usage_explanation],
        ["4. Borrower Verification", playbooks.borrower_verification],
        ["5. Credit Decision Process", playbooks.credit_decision_process],
        ["6. Override Handling", playbooks.override_handling],
        ["7. Audit Artifacts Map", playbooks.audit_artifacts_map],
      ];

      for (let i = 0; i < playbookSections.length; i++) {
        const [title, content] = playbookSections[i];

        if (i > 0) {
          doc.addPage();
        }

        // Section header
        doc.fontSize(16).fillColor("#333333").font("Helvetica-Bold");
        doc.text(title, { underline: true });
        doc.moveDown(0.5);

        // Section content — render line by line to handle plain-text formatting
        doc.fontSize(10).font("Helvetica").fillColor("#000000");
        const lines = content.split("\n");
        for (const line of lines) {
          if (doc.y > 680) {
            doc.addPage();
          }

          // Detect heading lines (all uppercase or with === or --- underlines)
          if (line.match(/^[A-Z][A-Z\s]+$/) && line.trim().length > 0) {
            doc.font("Helvetica-Bold").fontSize(12).text(line);
            doc.font("Helvetica").fontSize(10);
          } else if (line.match(/^[=-]+$/)) {
            // Skip underline decorations (already rendered heading above)
            continue;
          } else if (line.match(/^-{3,}$/)) {
            doc.moveTo(72, doc.y).lineTo(72 + contentWidth, doc.y).stroke("#cccccc");
            doc.moveDown(0.3);
          } else {
            doc.text(line, { lineGap: 2 });
          }
        }
      }

      // ── Integrity Footer ──────────────────────────────────
      doc.addPage();
      doc.fontSize(16).fillColor("#333333").font("Helvetica-Bold");
      doc.text("Integrity Statement", { underline: true });
      doc.moveDown(0.5);

      doc.fontSize(11).font("Helvetica").fillColor("#000000");
      doc.text(
        "This Examiner Playbook is a static, deterministic artifact produced by Buddy The Underwriter. " +
        "All content is pre-defined in code — no AI generation, no database lookups, no runtime computation. " +
        "The playbook hash below verifies the integrity of this document.",
        { lineGap: 4 },
      );
      doc.moveDown(1);

      doc.fontSize(12).font("Helvetica-Bold").text("Playbook Hash:");
      doc.moveDown(0.3);
      doc.fontSize(10).font("Courier").fillColor("#333333").text(playbookHash);
      doc.moveDown(1);

      doc.fontSize(10).font("Helvetica").fillColor("#000000");
      doc.text(`Playbook Version: ${playbooks.playbook_version}`);
      doc.text(`Generated: ${formatDT(playbooks.generated_at)}`);

      // ── Page Footers ────────────────────────────────────
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).fillColor("#999999").font("Helvetica");
        doc.text(
          `Page ${i + 1} of ${pageCount} | Buddy Examiner Playbook v${playbooks.playbook_version} | Hash: ${playbookHash.slice(0, 16)}… | ${formatDT(playbooks.generated_at)}`,
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

function formatDT(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return iso.slice(0, 19);
  }
}
