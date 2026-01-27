import PDFDocument from "pdfkit";
import type { BorrowerAuditSnapshot } from "./buildBorrowerAuditSnapshot";

/**
 * Render a borrower audit snapshot to a regulator-grade PDF.
 *
 * Sections:
 * 1. Borrower Summary
 * 2. Ownership Table
 * 3. Extraction Sources
 * 4. Confidence Scores
 * 5. Attestation Record
 * 6. Lifecycle Timeline
 * 7. Integrity Statement
 *
 * Every page includes: Hash, generation timestamp, Buddy branding.
 */
export function renderBorrowerAuditPdf(
  snapshot: BorrowerAuditSnapshot,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: "LETTER",
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: {
          Title: `Borrower Audit Snapshot — ${snapshot.borrower.legal_name ?? "Unknown"}`,
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
        snapshot.borrower.legal_name ?? "Unknown Borrower",
        { align: "center" },
      );
      doc.moveDown(2);

      doc.fontSize(11).fillColor("#666666");
      doc.text(`Generated: ${formatDT(snapshot.generated_at)}`, { align: "center" });
      doc.text(`Borrower ID: ${snapshot.borrower.id.slice(0, 8)}…`, { align: "center" });
      doc.text(`Snapshot Hash: ${snapshot.snapshot_hash.slice(0, 16)}…`, { align: "center" });
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
      const fields: [string, string | null][] = [
        ["Legal Name", b.legal_name],
        ["Entity Type", b.entity_type],
        ["EIN (Masked)", b.ein_masked],
        ["NAICS Code", b.naics_code],
        ["NAICS Description", b.naics_description],
        ["State of Formation", b.state_of_formation],
        ["Address", formatAddress(b.address)],
      ];

      for (const [label, value] of fields) {
        doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
        doc.font("Helvetica").text(value ?? "—");
      }
      doc.moveDown(1);

      // ── Section 2: Ownership Table ──────────────────────
      sectionHeader(doc, "2. Ownership Table");

      if (snapshot.owners.length > 0) {
        // Table header
        doc.fontSize(10).font("Helvetica-Bold");
        const colW = [180, 100, 80, 80];
        let y = doc.y;

        doc.text("Name", startX, y, { width: colW[0] });
        doc.text("Title", startX + colW[0], y, { width: colW[1] });
        doc.text("Ownership %", startX + colW[0] + colW[1], y, { width: colW[2] });
        doc.text("Source", startX + colW[0] + colW[1] + colW[2], y, { width: colW[3] });
        doc.moveDown(0.5);
        doc.moveTo(startX, doc.y).lineTo(startX + 440, doc.y).stroke("#cccccc");
        doc.moveDown(0.5);

        // Rows
        doc.fontSize(9).font("Helvetica");
        let totalPct = 0;
        for (const owner of snapshot.owners) {
          y = doc.y;
          if (y > 680) { doc.addPage(); y = doc.y; }
          doc.text(owner.name, startX, y, { width: colW[0] });
          doc.text(owner.title ?? "—", startX + colW[0], y, { width: colW[1] });
          doc.text(
            owner.ownership_pct !== null ? `${owner.ownership_pct.toFixed(1)}%` : "—",
            startX + colW[0] + colW[1], y, { width: colW[2] },
          );
          doc.text(owner.source, startX + colW[0] + colW[1] + colW[2], y, { width: colW[3] });
          doc.moveDown(0.8);
          totalPct += owner.ownership_pct ?? 0;
        }

        doc.moveDown(0.5);
        doc.font("Helvetica-Bold").text(`Total Ownership: ${totalPct.toFixed(1)}%`);
        doc.font("Helvetica").text(`Owner Count: ${snapshot.owners.length}`);
      } else {
        doc.fontSize(10).font("Helvetica").text("No owners on record.");
      }

      doc.moveDown(1);

      // ── Section 3: Extraction Sources ───────────────────
      doc.addPage();
      sectionHeader(doc, "3. Extraction Sources");

      if (snapshot.extraction.documents.length > 0) {
        doc.fontSize(10).font("Helvetica-Bold");
        const dColW = [200, 100, 160];
        let y = doc.y;

        doc.text("Filename", startX, y, { width: dColW[0] });
        doc.text("Type", startX + dColW[0], y, { width: dColW[1] });
        doc.text("Uploaded", startX + dColW[0] + dColW[1], y, { width: dColW[2] });
        doc.moveDown(0.5);
        doc.moveTo(startX, doc.y).lineTo(startX + 460, doc.y).stroke("#cccccc");
        doc.moveDown(0.5);

        doc.fontSize(9).font("Helvetica");
        for (const d of snapshot.extraction.documents) {
          y = doc.y;
          if (y > 680) { doc.addPage(); y = doc.y; }
          doc.text(d.filename ?? d.document_id.slice(0, 12), startX, y, { width: dColW[0] });
          doc.text(d.type ?? "—", startX + dColW[0], y, { width: dColW[1] });
          doc.text(d.uploaded_at ? formatDT(d.uploaded_at) : "—", startX + dColW[0] + dColW[1], y, { width: dColW[2] });
          doc.moveDown(0.8);
        }
      } else {
        doc.fontSize(10).font("Helvetica").text("No source documents on record.");
      }

      doc.moveDown(1);

      // ── Section 4: Confidence Scores ────────────────────
      sectionHeader(doc, "4. Confidence Scores");

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

      // ── Section 5: Attestation Record ───────────────────
      doc.addPage();
      sectionHeader(doc, "5. Attestation Record");

      const att = snapshot.attestation;
      doc.fontSize(11).font("Helvetica").fillColor("#000000");

      doc.font("Helvetica-Bold").text("Attested: ", { continued: true });
      if (att.attested) {
        doc.font("Helvetica").fillColor("#16a34a").text("YES");
      } else {
        doc.font("Helvetica").fillColor("#dc2626").text("NO");
      }
      doc.fillColor("#000000");

      if (att.attested) {
        doc.font("Helvetica-Bold").text("Attested By: ", { continued: true });
        doc.font("Helvetica").text(att.attested_by ?? "—");
        doc.font("Helvetica-Bold").text("Attested At: ", { continued: true });
        doc.font("Helvetica").text(att.attested_at ? formatDT(att.attested_at) : "—");
        doc.font("Helvetica-Bold").text("Attestation Snapshot Hash: ", { continued: true });
        doc.font("Helvetica").text(att.snapshot_hash?.slice(0, 32) ?? "—");
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
      doc.font("Helvetica-Bold").text("Borrower Created: ", { continued: true });
      doc.font("Helvetica").text(lc.borrower_created_at ? formatDT(lc.borrower_created_at) : "—");
      doc.font("Helvetica-Bold").text("Borrower Completed: ", { continued: true });
      doc.font("Helvetica").text(lc.borrower_completed_at ? formatDT(lc.borrower_completed_at) : "—");

      if (snapshot.ledger_refs.length > 0) {
        doc.moveDown(1);
        doc.fontSize(10).font("Helvetica-Bold").text("Ledger Events:");
        doc.moveDown(0.3);
        doc.fontSize(8).font("Helvetica");
        for (const ref of snapshot.ledger_refs.slice(0, 30)) {
          const y = doc.y;
          if (y > 700) { doc.addPage(); }
          doc.text(`[${formatDT(ref.created_at)}] ${ref.type}`);
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
      doc.text(snapshot.snapshot_hash);
      doc.moveDown(1);

      doc.fontSize(10).font("Helvetica").fillColor("#000000");
      doc.text(`Generated: ${formatDT(snapshot.generated_at)}`);
      doc.text(`Schema Version: ${snapshot.schema_version}`);
      doc.text(`Borrower: ${snapshot.borrower.legal_name ?? "Unknown"} (${snapshot.borrower.id.slice(0, 8)}…)`);
      doc.text(`Document Count: ${snapshot.extraction.documents.length}`);
      doc.text(`Owner Count: ${snapshot.owners.length}`);
      doc.text(`Attestation: ${snapshot.attestation.attested ? "Yes" : "No"}`);
      doc.text(`Ledger Events: ${snapshot.ledger_refs.length}`);

      // ── Page Footers ────────────────────────────────────
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).fillColor("#999999").font("Helvetica");
        doc.text(
          `Page ${i + 1} of ${pageCount} | Buddy Audit Snapshot | Hash: ${snapshot.snapshot_hash.slice(0, 16)}… | ${formatDT(snapshot.generated_at)}`,
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

function formatAddress(addr: { line1: string | null; city: string | null; state: string | null; zip: string | null }): string | null {
  const parts = [addr.line1, addr.city, addr.state, addr.zip].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}
