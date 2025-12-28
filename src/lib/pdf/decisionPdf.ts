import "server-only";
import PDFDocument from "pdfkit";
import crypto from "crypto";
import QRCode from "qrcode";

interface DecisionSnapshot {
  id: string;
  deal_id: string;
  created_at: string;
  status: string;
  decision: string;
  decision_summary?: string;
  confidence?: number;
  confidence_explanation?: string;
  inputs_json?: any;
  evidence_snapshot_json?: any;
  policy_snapshot_json?: any;
  policy_eval_json?: any;
  exceptions_json?: any;
  model_json?: any;
  hash?: string;
}

export function renderDecisionPdf(
  snapshot: DecisionSnapshot,
  letterheadBuffer?: Buffer | null
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Letterhead (if provided)
    if (letterheadBuffer) {
      try {
        doc.image(letterheadBuffer, 50, 40, { 
          width: doc.page.width - 100, 
          height: 100,
          fit: [doc.page.width - 100, 100],
          align: "center"
        });
        doc.moveDown(7); // Space after letterhead
      } catch (err) {
        console.error("Failed to render letterhead in PDF:", err);
        // Continue without letterhead if image fails
      }
    }

    // Header
    doc.fontSize(20).font("Helvetica-Bold").text("Underwriting Decision Record", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica").fillColor("#666666");
    doc.text("Immutable Snapshot • Audit-Ready Export", { align: "center" });
    doc.fillColor("#000000");
    doc.moveDown(1.5);

    // Metadata section
    doc.fontSize(12).font("Helvetica-Bold").text("Decision Metadata");
    doc.fontSize(10).font("Helvetica").moveDown(0.3);
    doc.text(`Decision ID: ${snapshot.id}`, { indent: 20 });
    doc.text(`Deal ID: ${snapshot.deal_id}`, { indent: 20 });
    doc.text(`Created At: ${new Date(snapshot.created_at).toLocaleString("en-US")}`, { indent: 20 });
    doc.text(`Status: ${snapshot.status.toUpperCase()}`, { indent: 20 });
    doc.moveDown(1);

    // Decision section
    doc.fontSize(12).font("Helvetica-Bold").text("Decision");
    doc.fontSize(10).font("Helvetica").moveDown(0.3);
    doc.fillColor("#1a73e8").fontSize(11).font("Helvetica-Bold");
    doc.text(`Outcome: ${snapshot.decision}`, { indent: 20 });
    doc.fillColor("#000000").fontSize(10).font("Helvetica");

    if (snapshot.decision_summary) {
      doc.text(`Summary: ${snapshot.decision_summary}`, { indent: 20 });
    }

    if (snapshot.confidence !== undefined && snapshot.confidence !== null) {
      const confidencePct = Math.round(snapshot.confidence * 100);
      doc.text(`Confidence: ${confidencePct}%`, { indent: 20 });
    }

    if (snapshot.confidence_explanation) {
      doc.text(`Explanation: ${snapshot.confidence_explanation}`, { indent: 20 });
    }
    doc.moveDown(1);

    // Inputs section
    doc.fontSize(12).font("Helvetica-Bold").text("Inputs");
    doc.fontSize(9).font("Courier").fillColor("#333333").moveDown(0.3);
    doc.text(JSON.stringify(snapshot.inputs_json || {}, null, 2), { indent: 20, width: 500 });
    doc.fillColor("#000000").font("Helvetica").moveDown(1);

    // Evidence section
    doc.addPage();
    doc.fontSize(12).font("Helvetica-Bold").text("Evidence Snapshot");
    doc.fontSize(9).font("Courier").fillColor("#333333").moveDown(0.3);
    const evidenceText = JSON.stringify(snapshot.evidence_snapshot_json || [], null, 2);
    doc.text(evidenceText.substring(0, 3000), { indent: 20, width: 500 }); // Truncate for PDF size
    if (evidenceText.length > 3000) {
      doc.text("... (truncated for brevity)", { indent: 20 });
    }
    doc.fillColor("#000000").font("Helvetica").moveDown(1);

    // Policy section
    doc.addPage();
    doc.fontSize(12).font("Helvetica-Bold").text("Policy Snapshot");
    doc.fontSize(9).font("Courier").fillColor("#333333").moveDown(0.3);
    const policyText = JSON.stringify(snapshot.policy_snapshot_json || [], null, 2);
    doc.text(policyText.substring(0, 3000), { indent: 20, width: 500 });
    if (policyText.length > 3000) {
      doc.text("... (truncated for brevity)", { indent: 20 });
    }
    doc.fillColor("#000000").font("Helvetica").moveDown(1);

    // Policy Evaluation section
    doc.fontSize(12).font("Helvetica-Bold").text("Policy Evaluation");
    doc.fontSize(9).font("Courier").fillColor("#333333").moveDown(0.3);
    doc.text(JSON.stringify(snapshot.policy_eval_json || {}, null, 2), { indent: 20, width: 500 });
    doc.fillColor("#000000").font("Helvetica").moveDown(1);

    // Exceptions section
    if (snapshot.exceptions_json) {
      doc.fontSize(12).font("Helvetica-Bold").text("Exceptions");
      doc.fontSize(9).font("Courier").fillColor("#333333").moveDown(0.3);
      doc.text(JSON.stringify(snapshot.exceptions_json, null, 2), { indent: 20, width: 500 });
      doc.fillColor("#000000").font("Helvetica").moveDown(1);
    }

    // Provenance section
    doc.addPage();
    doc.fontSize(12).font("Helvetica-Bold").text("Provenance");
    doc.fontSize(9).font("Courier").fillColor("#333333").moveDown(0.3);
    doc.text(JSON.stringify(snapshot.model_json || {}, null, 2), { indent: 20, width: 500 });
    doc.fillColor("#000000").font("Helvetica").moveDown(1.5);

    // Integrity footer with QR code
    const payload = JSON.stringify(snapshot, Object.keys(snapshot).sort());
    const digest = crypto.createHash("sha256").update(payload).digest("hex");

    doc.rect(50, doc.page.height - 180, doc.page.width - 100, 130).fillAndStroke("#f5f5f5", "#cccccc");
    doc.fillColor("#000000");
    doc.fontSize(11).font("Helvetica-Bold").text("Integrity Verification", 60, doc.page.height - 170);
    doc.fontSize(9).font("Helvetica").moveDown(0.3);
    doc.text("This PDF was generated directly from an immutable decision snapshot.", { indent: 10 });
    doc.fontSize(8).font("Courier");
    doc.text(`SHA-256: ${digest}`, { indent: 10 });
    doc.font("Helvetica");
    doc.text(`Generated At: ${new Date().toISOString()}`, { indent: 10 });
    
    // Add QR code for external verification
    const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://buddy.app'}/api/verify/${digest}`;
    QRCode.toDataURL(verifyUrl, { width: 80, margin: 1 }, (err, qrDataUrl) => {
      if (!err && qrDataUrl) {
        const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');
        doc.image(qrBuffer, doc.page.width - 140, doc.page.height - 165, { width: 80, height: 80 });
        doc.fontSize(7).fillColor("#666666");
        doc.text("Scan to verify", doc.page.width - 140, doc.page.height - 80, { width: 80, align: "center" });
      }
      doc.end();
    });
  });
}
