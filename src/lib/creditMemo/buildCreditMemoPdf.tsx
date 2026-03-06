/**
 * Credit Memo PDF — Document Assembler
 *
 * Server-side only. Uses @react-pdf/renderer to build a complete
 * credit memorandum PDF from spread output data.
 */

import "server-only";

import React from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { styles } from "./styles";
import type { CreditMemoInput, CreditMemoExportResult } from "./types";
import { CoverPage } from "./sections/CoverPage";
import { ExecutiveSummarySection } from "./sections/ExecutiveSummarySection";
import { NormalizedSpreadSection } from "./sections/NormalizedSpreadSection";
import { RatioScorecardSection } from "./sections/RatioScorecardSection";
import { RiskFlagsSection } from "./sections/RiskFlagsSection";
import { StorySection } from "./sections/StorySection";
import { ConsolidationBridgeSection } from "./sections/ConsolidationBridgeSection";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function buildCreditMemoPdf(
  input: CreditMemoInput,
): Promise<CreditMemoExportResult> {
  try {
    const doc = (
      <Document
        title={`Credit Memo \u2014 ${input.borrower_name}`}
        author={input.bank_name}
        subject="Confidential Credit Memorandum"
        creator="Buddy The Underwriter"
      >
        {/* Cover Page */}
        <Page size="LETTER" style={styles.page}>
          <CoverPage input={input} />
        </Page>

        {/* Executive Summary */}
        <Page size="LETTER" style={styles.page}>
          <ExecutiveSummarySection summary={input.spread_report.executive_summary} />
          <MemoFooter input={input} />
        </Page>

        {/* Normalized Spread — landscape for wide tables */}
        <Page size="LETTER" style={styles.page} orientation="landscape">
          <NormalizedSpreadSection spread={input.spread_report.normalized_spread} />
          <MemoFooter input={input} />
        </Page>

        {/* Ratio Scorecard */}
        <Page size="LETTER" style={styles.page}>
          <RatioScorecardSection scorecard={input.spread_report.ratio_scorecard} />
          <MemoFooter input={input} />
        </Page>

        {/* Risk Flags — may overflow to multiple pages */}
        <Page size="LETTER" style={styles.page}>
          <RiskFlagsSection flags={input.flag_report.flags} />
          <MemoFooter input={input} />
        </Page>

        {/* Credit Analysis / Story */}
        <Page size="LETTER" style={styles.page}>
          <StorySection story={input.spread_report.story_panel} />
          <MemoFooter input={input} />
        </Page>

        {/* Consolidation Bridge — landscape, only if multi-entity */}
        {input.consolidation_bridge ? (
          <Page size="LETTER" style={styles.page} orientation="landscape">
            <ConsolidationBridgeSection bridge={input.consolidation_bridge} />
            <MemoFooter input={input} />
          </Page>
        ) : null}
      </Document>
    );

    const buffer = await renderToBuffer(doc);
    const pdfBytes = new Uint8Array(buffer);

    return { ok: true, pdf_bytes: pdfBytes };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[creditMemo] PDF build failed", message);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Footer — rendered on every non-cover page
// ---------------------------------------------------------------------------

function MemoFooter({ input }: { input: CreditMemoInput }) {
  return (
    <View style={styles.footer} fixed>
      <Text>CONFIDENTIAL \u2014 {input.borrower_name} \u2014 {input.deal_name}</Text>
      <Text
        render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `Page ${pageNumber} of ${totalPages}`
        }
      />
      <Text>Generated {input.prepared_at} by Buddy The Underwriter</Text>
    </View>
  );
}
