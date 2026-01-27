import PDFDocument from "pdfkit";
import type { BorrowerAuditSnapshot } from "./buildBorrowerAuditSnapshot";

/**
 * Render a borrower audit snapshot to a regulator-grade PDF.
 *
 * Sections (fixed order):
 * 1. Borrower Summary
 * 2. Ownership Table (with confidence)
 * 3. Source Documents
 * 4. Confidence Breakdown
 * 5. Owner Attestation Record
 * 6. Lifecycle Timeline
 * 7. Integrity Statement
 *
 * Footer (every page):
 *   Buddy Borrower Audit Snapshot
 *   Hash: <snapshotHash>
 *   Generated: <UTC timestamp>
 */
export function renderBorrowerAuditPdf(
  snapshot: BorrowerAuditSnapshot,
  snapshotHash: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: "LETTER",
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: {
          Title: `Borrower Audit Snapshot — ${snapshot.borrower.legal_name || "Unknown"}`,
          Author: "Buddy The Underwriter",
          Subject: "Borrower Audit Export",
          Keywords: "audit, borrower, compliance, attestation, confidence",
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
      doc.fontSize(24).font("Helvetica-Bold").text("BORROWER AUDIT SNAPSHOT", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(14).font("Helvetica").text(
        snapshot.borrower.legal_name || "Unknown Borrower",
        { align: "center" },
      );
      doc.moveDown(2);

      doc.fontSize(11).fillColor("#666666");
      doc.text(`Generated: ${formatDT(snapshot.meta.generated_at)}`, { align: "center" });
      doc.text(`As Of: ${formatDT(snapshot.meta.as_of)}`, { align: "center" });
      doc.text(`Borrower ID: ${snapshot.meta.borrower_id.slice(0, 8)}…`, { align: "center" });
      doc.text(`Snapshot Hash: ${snapshotHash.slice(0, 16)}…`, { align: "center" });
      doc.moveDown(2);

      doc.fontSize(10).fillColor("#999999").font("Helvetica-Oblique");
      doc.text(
        "This document is a tamper-evident audit artifact. Every fact is traceable to a document, " +
        "extraction, user attestation, or ledger event. The snapshot hash may be independently verified.",
        { align: "center", lineGap: 3 },
      );

      doc.addPage();

      // ── Section 1: Borrower Summary ─────────────────────
      sectionHeader(doc, "1. Borrower Summary");
      doc.fontSize(11).font("Helvetica").fillColor("#000000");

      const b = snapshot.borrower;
      const fields: [string, string][] = [
        ["Legal Name", b.legal_name || "—"],
        ["Entity Type", b.entity_type || "—"],
        ["EIN (Masked)", b.ein_masked || "—"],
        ["NAICS", b.naics || "—"],
        ["Address", formatAddress(b.address)],
      ];

      for (const [label, value] of fields) {
        doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
        doc.font("Helvetica").text(value);
      }
      doc.moveDown(1);

      // ── Section 2: Ownership Table ──────────────────────
      sectionHeader(doc, "2. Ownership Table");

      if (snapshot.owners.length > 0) {
        doc.fontSize(10).font("Helvetica-Bold");
        const colW = [200, 80, 80, 100];
        let y = doc.y;

        doc.text("Name", startX, y, { width: colW[0] });
        doc.text("Ownership %", startX + colW[0], y, { width: colW[1] });
        doc.text("Confidence", startX + colW[0] + colW[1], y, { width: colW[2] });
        doc.text("Source", startX + colW[0] + colW[1] + colW[2], y, { width: colW[3] });
        doc.moveDown(0.5);
        doc.moveTo(startX, doc.y).lineTo(startX + 460, doc.y).stroke("#cccccc");
        doc.moveDown(0.5);

        doc.fontSize(9).font("Helvetica");
        let totalPct = 0;
        for (const owner of snapshot.owners) {
          y = doc.y;
          if (y > 680) { doc.addPage(); y = doc.y; }
          doc.text(owner.name, startX, y, { width: colW[0] });
          doc.text(`${owner.ownership_pct.toFixed(1)}%`, startX + colW[0], y, { width: colW[1] });

          const confPct = (owner.confidence * 100).toFixed(0);
          const confColor = owner.confidence >= 0.85 ? "#16a34a" : owner.confidence >= 0.60 ? "#d97706" : "#dc2626";
          doc.fillColor(confColor).text(`${confPct}%`, startX + colW[0] + colW[1], y, { width: colW[2] });
          doc.fillColor("#000000").text(owner.source, startX + colW[0] + colW[1] + colW[2], y, { width: colW[3] });

          doc.moveDown(0.8);
          totalPct += owner.ownership_pct;
        }

        doc.moveDown(0.5);
        doc.font("Helvetica-Bold").text(`Total Ownership: ${totalPct.toFixed(1)}%`);
        doc.font("Helvetica").text(`Owner Count: ${snapshot.owners.length}`);
      } else {
        doc.fontSize(10).font("Helvetica").text("No attested owners on record.");
      }

      doc.moveDown(1);

      // ── Section 3: Source Documents ─────────────────────
      doc.addPage();
      sectionHeader(doc, "3. Source Documents");

      if (snapshot.extraction.documents.length > 0) {
        doc.fontSize(10).font("Helvetica-Bold");
        const dColW = [100, 150, 210];
        let y = doc.y;

        doc.text("Type", startX, y, { width: dColW[0] });
        doc.text("Uploaded", startX + dColW[0], y, { width: dColW[1] });
        doc.text("SHA-256", startX + dColW[0] + dColW[1], y, { width: dColW[2] });
        doc.moveDown(0.5);
        doc.moveTo(startX, doc.y).lineTo(startX + 460, doc.y).stroke("#cccccc");
        doc.moveDown(0.5);

        doc.fontSize(9).font("Helvetica");
        for (const d of snapshot.extraction.documents) {
          y = doc.y;
          if (y > 680) { doc.addPage(); y = doc.y; }
          doc.text(d.document_type || "—", startX, y, { width: dColW[0] });
          doc.text(d.uploaded_at ? formatDT(d.uploaded_at) : "—", startX + dColW[0], y, { width: dColW[1] });
          doc.font("Courier").fontSize(7).text(
            d.sha256 ? d.sha256.slice(0, 24) + "…" : "—",
            startX + dColW[0] + dColW[1], y, { width: dColW[2] },
          );
          doc.font("Helvetica").fontSize(9);
          doc.moveDown(0.8);
        }
      } else {
        doc.fontSize(10).font("Helvetica").text("No source documents on record.");
      }

      doc.moveDown(1);

      // ── Section 4: Confidence Breakdown ─────────────────
      sectionHeader(doc, "4. Confidence Breakdown");

      const fc = snapshot.extraction.field_confidence;
      const confEntries = Object.entries(fc).sort(([a], [b]) => a.localeCompare(b));

      if (confEntries.length > 0) {
        doc.fontSize(10).font("Helvetica-Bold");
        let y = doc.y;
        doc.text("Field", startX, y, { width: 200 });
        doc.text("Confidence", startX + 200, y, { width: 80 });
        doc.text("Level", startX + 280, y, { width: 100 });
        doc.moveDown(0.5);
        doc.moveTo(startX, doc.y).lineTo(startX + 380, doc.y).stroke("#cccccc");
        doc.moveDown(0.5);

        doc.fontSize(9).font("Helvetica");
        for (const [field, conf] of confEntries) {
          y = doc.y;
          if (y > 680) { doc.addPage(); y = doc.y; }
          const pct = (conf * 100).toFixed(0);
          const level = conf >= 0.85 ? "HIGH" : conf >= 0.60 ? "REVIEW" : "LOW";
          const color = conf >= 0.85 ? "#16a34a" : conf >= 0.60 ? "#d97706" : "#dc2626";

          doc.fillColor("#000000").text(field.replace(/_/g, " "), startX, y, { width: 200 });
          doc.text(`${pct}%`, startX + 200, y, { width: 80 });
          doc.fillColor(color).text(level, startX + 280, y, { width: 100 });
          doc.fillColor("#000000");
          doc.moveDown(0.8);
        }
      } else {
        doc.fontSize(10).font("Helvetica").text("No confidence data available.");
      }

      doc.moveDown(1);

      // ── Section 5: Owner Attestation Record ─────────────
      doc.addPage();
      sectionHeader(doc, "5. Owner Attestation Record");

      const a = snapshot.attestation;
      doc.fontSize(11).font("Helvetica").fillColor("#000000");

      doc.font("Helvetica-Bold").text("Attested: ", { continued: true });
      if (a.attested) {
        doc.font("Helvetica").fillColor("#16a34a").text("YES");
      } else {
        doc.font("Helvetica").fillColor("#dc2626").text("NO");
      }
      doc.fillColor("#000000");

      if (a.attested) {
        doc.font("Helvetica-Bold").text("Attested By (User ID): ", { continued: true });
        doc.font("Helvetica").text(a.attested_by_user_id ?? "—");
        doc.font("Helvetica-Bold").text("Attested At: ", { continued: true });
        doc.font("Helvetica").text(a.attested_at ? formatDT(a.attested_at) : "—");
        doc.font("Helvetica-Bold").text("Attestation Snapshot Hash: ", { continued: true });
        doc.font("Helvetica").text(a.snapshot_hash?.slice(0, 32) ?? "—");
      } else {
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor("#dc2626").font("Helvetica-Oblique");
        doc.text("Ownership has not been attested. Borrower is not complete for underwriting.");
        doc.fillColor("#000000");
      }

      doc.moveDown(1);

      // ── Section 6: Lifecycle Timeline ───────────────────
      sectionHeader(doc, "6. Lifecycle Timeline");
      doc.fontSize(11).font("Helvetica").fillColor("#000000");

      const lc = snapshot.lifecycle;
      doc.font("Helvetica-Bold").text("Borrower Completed: ", { continued: true });
      doc.font("Helvetica").text(lc.borrower_completed_at ? formatDT(lc.borrower_completed_at) : "—");
      doc.font("Helvetica-Bold").text("Underwriting Unlocked: ", { continued: true });
      doc.font("Helvetica").text(lc.underwriting_unlocked_at ? formatDT(lc.underwriting_unlocked_at) : "—");

      if (snapshot.ledger_events.length > 0) {
        doc.moveDown(1);
        doc.fontSize(10).font("Helvetica-Bold").text("Ledger Events:");
        doc.moveDown(0.3);
        doc.fontSize(8).font("Helvetica");
        for (const ev of snapshot.ledger_events.slice(0, 30)) {
          const y = doc.y;
          if (y > 700) { doc.addPage(); }
          doc.text(`[${formatDT(ev.created_at)}] ${ev.type}`);
        }
      }

      doc.moveDown(1);

      // ── Section 7: Integrity Statement ──────────────────
      doc.addPage();
      sectionHeader(doc, "7. Integrity Statement");

      doc.fontSize(11).font("Helvetica").fillColor("#000000");
      doc.text(
        "This Borrower Audit Snapshot is a deterministic export produced by Buddy The Underwriter. " +
        "The snapshot hash below is computed from the canonical JSON representation of all data " +
        "in this document using SHA-256. Any modification to the underlying data will produce a " +
        "different hash.",
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
      doc.text(`Borrower: ${snapshot.borrower.legal_name || "Unknown"} (${snapshot.meta.borrower_id.slice(0, 8)}…)`);
      doc.text(`Document Count: ${snapshot.extraction.documents.length}`);
      doc.text(`Owner Count: ${snapshot.owners.length}`);
      doc.text(`Attestation: ${snapshot.attestation.attested ? "Yes" : "No"}`);
      doc.text(`Ledger Events: ${snapshot.ledger_events.length}`);

      // ── Page Footers ────────────────────────────────────
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).fillColor("#999999").font("Helvetica");
        doc.text(
          `Page ${i + 1} of ${pageCount} | Buddy Borrower Audit Snapshot | Hash: ${snapshotHash.slice(0, 16)}… | ${formatDT(snapshot.meta.generated_at)}`,
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

function formatAddress(addr: { street: string; city: string; state: string; zip: string }): string {
  const parts = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
}
