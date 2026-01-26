/**
 * Document Generation for Research Exports
 *
 * Generates PDF and DOCX documents from research mission data.
 * Uses pdfkit for PDF and docx for Word documents.
 *
 * Bank-grade quality: proper formatting, headers, footers, audit trail.
 */

import PDFDocument from "pdfkit";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  Footer,
  PageNumber,
  Header,
} from "docx";
import type { CreditCommitteePack, RiskIndicator } from "../creditCommitteePack";
import type { ResearchSource, NarrativeSentence } from "../types";

// ============================================================================
// Types
// ============================================================================

export type DocumentFormat = "pdf" | "docx";

export type GenerateDocumentInput = {
  pack: CreditCommitteePack;
  sources: ResearchSource[];
  format: DocumentFormat;
  missionId: string;
  dealName?: string;
  generatedAt?: string;
};

export type GenerateDocumentResult = {
  ok: boolean;
  buffer?: Buffer;
  filename?: string;
  contentType?: string;
  error?: string;
};

// ============================================================================
// Main Export Functions
// ============================================================================

/**
 * Generate a document (PDF or DOCX) from research data.
 */
export async function generateDocument(
  input: GenerateDocumentInput
): Promise<GenerateDocumentResult> {
  const { format, missionId, dealName, generatedAt } = input;
  const timestamp = generatedAt ?? new Date().toISOString();
  const sanitizedDealName = (dealName ?? "Research").replace(/[^a-zA-Z0-9-_]/g, "_");
  const filename = `${sanitizedDealName}-Research-${missionId.slice(0, 8)}-${timestamp.slice(0, 10)}`;

  try {
    if (format === "pdf") {
      const buffer = await generatePDF(input);
      return {
        ok: true,
        buffer,
        filename: `${filename}.pdf`,
        contentType: "application/pdf",
      };
    }

    if (format === "docx") {
      const buffer = await generateDOCX(input);
      return {
        ok: true,
        buffer,
        filename: `${filename}.docx`,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    }

    return {
      ok: false,
      error: `Unsupported format: ${format}`,
    };
  } catch (error) {
    console.error(`[generateDocument] Error generating ${format}:`, error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Document generation failed",
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract plain text from NarrativeSentence array.
 */
function sentencesToText(sentences: NarrativeSentence[]): string {
  return sentences.map((s) => s.text).join(" ");
}

/**
 * Get risk level color for PDF.
 */
function getRiskColor(level: RiskIndicator["level"]): string {
  switch (level) {
    case "high": return "#dc2626";
    case "medium": return "#d97706";
    case "low": return "#16a34a";
    default: return "#666666";
  }
}

/**
 * Get risk level icon.
 */
function getRiskIcon(level: RiskIndicator["level"]): string {
  switch (level) {
    case "high": return "[!]";
    case "medium": return "[*]";
    case "low": return "[-]";
    default: return "[ ]";
  }
}

// ============================================================================
// PDF Generation
// ============================================================================

async function generatePDF(input: GenerateDocumentInput): Promise<Buffer> {
  const { pack, sources, missionId, dealName, generatedAt } = input;
  const timestamp = generatedAt ?? new Date().toISOString();
  const docTitle = dealName ?? `Deal ${pack.deal_id.slice(0, 8)}`;

  return new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: "LETTER",
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: {
          Title: `Research Report - ${docTitle}`,
          Author: "Buddy Research Engine",
          Subject: "Credit Committee Research",
          Keywords: "research, underwriting, credit",
          Creator: "Buddy The Underwriter",
          CreationDate: new Date(),
        },
      });

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // --- Title Page ---
      doc.fontSize(24).font("Helvetica-Bold").text("CREDIT COMMITTEE", { align: "center" });
      doc.fontSize(20).text("RESEARCH REPORT", { align: "center" });
      doc.moveDown(2);

      doc.fontSize(16).font("Helvetica").text(docTitle, { align: "center" });
      doc.moveDown(1);

      doc.fontSize(12).fillColor("#666666");
      doc.text(`Generated: ${formatDateTime(timestamp)}`, { align: "center" });
      doc.text(`Mission ID: ${missionId.slice(0, 8)}...`, { align: "center" });
      doc.text(`Total Facts: ${pack.total_facts}`, { align: "center" });
      doc.text(`Total Inferences: ${pack.total_inferences}`, { align: "center" });

      // Risk indicators summary
      if (pack.risk_indicators.length > 0) {
        doc.moveDown(2);
        doc.fontSize(14).fillColor("#333333").font("Helvetica-Bold").text("Risk Indicators", { align: "center" });
        doc.moveDown(0.5);
        doc.fontSize(11).font("Helvetica");
        for (const indicator of pack.risk_indicators.slice(0, 5)) {
          const icon = getRiskIcon(indicator.level);
          doc.fillColor(getRiskColor(indicator.level));
          doc.text(`${icon} ${indicator.summary}`, { align: "center" });
        }
      }

      doc.addPage();

      // --- Table of Contents ---
      doc.fontSize(16).fillColor("#333333").font("Helvetica-Bold").text("Contents", { underline: true });
      doc.moveDown(1);
      doc.fontSize(11).font("Helvetica");

      for (let i = 0; i < pack.sections.length; i++) {
        const section = pack.sections[i];
        doc.text(`${i + 1}. ${section.title}`, { continued: false });
      }
      doc.text(`${pack.sections.length + 1}. Source Appendix`);

      doc.addPage();

      // --- Sections ---
      for (let i = 0; i < pack.sections.length; i++) {
        const section = pack.sections[i];

        // Section header
        doc.fontSize(14).fillColor("#333333").font("Helvetica-Bold");
        doc.text(`${i + 1}. ${section.title}`, { underline: true });
        doc.moveDown(0.5);

        // Section content
        doc.fontSize(11).fillColor("#000000").font("Helvetica");

        // Convert NarrativeSentence[] to plain text
        const cleanContent = sentencesToText(section.content);
        doc.text(cleanContent, {
          align: "justify",
          lineGap: 4,
        });

        // Mission IDs reference
        if (section.mission_ids && section.mission_ids.length > 0) {
          doc.moveDown(0.5);
          doc.fontSize(9).fillColor("#666666").font("Helvetica-Oblique");
          doc.text(`Missions: ${section.mission_ids.length}`, { align: "right" });
        }

        doc.moveDown(1.5);

        // Add page break between major sections (not after last)
        if (i < pack.sections.length - 1 && cleanContent.length > 500) {
          doc.addPage();
        }
      }

      // --- Source Appendix ---
      doc.addPage();
      doc.fontSize(14).fillColor("#333333").font("Helvetica-Bold");
      doc.text("Source Appendix", { underline: true });
      doc.moveDown(1);

      doc.fontSize(10).fillColor("#000000").font("Helvetica");

      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        const checksumPrefix = source.checksum?.slice(0, 8) ?? "N/A";
        const retrieved = source.retrieved_at
          ? formatDateTime(source.retrieved_at)
          : "N/A";

        doc.font("Helvetica-Bold").text(`[${i + 1}] ${source.source_name}`, { continued: false });
        doc.font("Helvetica").text(`   URL: ${truncateString(source.source_url, 70)}`);
        doc.text(`   Retrieved: ${retrieved} | Checksum: ${checksumPrefix}`);
        doc.moveDown(0.5);
      }

      // --- Footer with page numbers (on each page) ---
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor("#999999");
        doc.text(
          `Page ${i + 1} of ${pageCount} | Buddy Research Engine | ${formatDateTime(timestamp)}`,
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
// DOCX Generation
// ============================================================================

async function generateDOCX(input: GenerateDocumentInput): Promise<Buffer> {
  const { pack, sources, missionId, dealName, generatedAt } = input;
  const timestamp = generatedAt ?? new Date().toISOString();
  const docTitle = dealName ?? `Deal ${pack.deal_id.slice(0, 8)}`;

  // Build document sections
  const children: Paragraph[] = [];

  // --- Title ---
  children.push(
    new Paragraph({
      text: "CREDIT COMMITTEE RESEARCH REPORT",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  );

  children.push(
    new Paragraph({
      text: docTitle,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // --- Metadata ---
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [
        new TextRun({ text: `Generated: ${formatDateTime(timestamp)}`, color: "666666", size: 22 }),
      ],
    })
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [
        new TextRun({ text: `Mission ID: ${missionId.slice(0, 8)}...`, color: "666666", size: 22 }),
      ],
    })
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({
          text: `Facts: ${pack.total_facts} | Inferences: ${pack.total_inferences}`,
          color: "666666",
          size: 22,
        }),
      ],
    })
  );

  // --- Risk Indicators Summary ---
  if (pack.risk_indicators.length > 0) {
    children.push(
      new Paragraph({
        text: "Risk Indicators",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 },
      })
    );

    for (const indicator of pack.risk_indicators) {
      const color = getRiskColor(indicator.level).replace("#", "");
      const icon = getRiskIcon(indicator.level);
      children.push(
        new Paragraph({
          spacing: { after: 100 },
          children: [
            new TextRun({ text: `${icon} `, bold: true, color }),
            new TextRun({ text: indicator.summary, color }),
          ],
        })
      );
    }
  }

  // Page break before content
  children.push(new Paragraph({ pageBreakBefore: true }));

  // --- Table of Contents ---
  children.push(
    new Paragraph({
      text: "Contents",
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    })
  );

  for (let i = 0; i < pack.sections.length; i++) {
    const section = pack.sections[i];
    children.push(
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({ text: `${i + 1}. ${section.title}` }),
        ],
      })
    );
  }
  children.push(
    new Paragraph({
      spacing: { after: 400 },
      children: [
        new TextRun({ text: `${pack.sections.length + 1}. Source Appendix` }),
      ],
    })
  );

  children.push(new Paragraph({ pageBreakBefore: true }));

  // --- Sections ---
  for (let i = 0; i < pack.sections.length; i++) {
    const section = pack.sections[i];

    // Section heading
    children.push(
      new Paragraph({
        text: `${i + 1}. ${section.title}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      })
    );

    // Section content - convert to plain text and split by paragraphs
    const plainText = sentencesToText(section.content);
    const paragraphs = plainText.split("\n\n");
    for (const para of paragraphs) {
      if (para.trim()) {
        children.push(
          new Paragraph({
            text: para.trim(),
            spacing: { after: 200 },
          })
        );
      }
    }

    // Mission IDs
    if (section.mission_ids && section.mission_ids.length > 0) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 100 },
          children: [
            new TextRun({ text: `Missions included: ${section.mission_ids.length}`, color: "666666", size: 20, italics: true }),
          ],
        })
      );
    }
  }

  // Page break before appendix
  children.push(new Paragraph({ pageBreakBefore: true }));

  // --- Source Appendix ---
  children.push(
    new Paragraph({
      text: "Source Appendix",
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 300 },
    })
  );

  // Source table
  const tableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: 5, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ text: "#", alignment: AlignmentType.CENTER })],
          shading: { fill: "f3f4f6" },
        }),
        new TableCell({
          width: { size: 25, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ text: "Source" })],
          shading: { fill: "f3f4f6" },
        }),
        new TableCell({
          width: { size: 40, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ text: "URL" })],
          shading: { fill: "f3f4f6" },
        }),
        new TableCell({
          width: { size: 20, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ text: "Retrieved" })],
          shading: { fill: "f3f4f6" },
        }),
        new TableCell({
          width: { size: 10, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ text: "Checksum" })],
          shading: { fill: "f3f4f6" },
        }),
      ],
    }),
  ];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const checksumPrefix = source.checksum?.slice(0, 8) ?? "N/A";
    const retrieved = source.retrieved_at ? formatDateTime(source.retrieved_at) : "N/A";

    tableRows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ text: String(i + 1), alignment: AlignmentType.CENTER })],
          }),
          new TableCell({
            children: [new Paragraph({ text: source.source_name })],
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: truncateString(source.source_url, 50), size: 18 })],
              }),
            ],
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: retrieved, size: 18 })] })],
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: checksumPrefix, font: "Courier New", size: 18 })],
              }),
            ],
          }),
        ],
      })
    );
  }

  const sourceTable = new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });

  // Create document with header and footer
  const doc = new Document({
    creator: "Buddy Research Engine",
    title: `Research Report - ${docTitle}`,
    description: "Credit Committee Research Report",
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: "Buddy Research Engine", color: "999999", size: 18 }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Page ", color: "999999", size: 18 }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    color: "999999",
                    size: 18,
                  }),
                  new TextRun({ text: " of ", color: "999999", size: 18 }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    color: "999999",
                    size: 18,
                  }),
                  new TextRun({ text: ` | ${formatDateTime(timestamp)}`, color: "999999", size: 18 }),
                ],
              }),
            ],
          }),
        },
        children: [...children, sourceTable],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return isoString.slice(0, 16).replace("T", " ");
  }
}

function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}
