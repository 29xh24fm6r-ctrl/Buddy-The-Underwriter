"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";

const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

type DocumentSummary = {
  id: string;
  filename: string;
  docType: string | null;
  docYear: number | null;
  docYears: number[] | null;
  confidence: number | null;
  hasOcr: boolean;
  ocrProvider: string | null;
  textLength: number | null;
  classifiedAt: string | null;
};

type OcrSummary = {
  ok: boolean;
  stats: {
    totalDocuments: number;
    documentsWithOcr: number;
    documentsClassified: number;
    documentsUnknown: number;
  };
  documents: DocumentSummary[];
  financialData: {
    taxYears: number[];
    businessTaxReturns: number;
    personalTaxReturns: number;
    financialStatements: number;
    bankStatements: number;
    otherDocuments: number;
  };
};

function formatDocType(docType: string | null): string {
  if (!docType) return "Unknown";
  const dt = docType.toLowerCase();
  if (dt.includes("business_tax") || dt.includes("1120") || dt.includes("1065")) return "Business Tax Return";
  if (dt.includes("personal_tax") || dt.includes("1040")) return "Personal Tax Return";
  if (dt.includes("income_statement")) return "Income Statement";
  if (dt.includes("balance_sheet")) return "Balance Sheet";
  if (dt.includes("financial_statement")) return "Financial Statement";
  if (dt.includes("bank_statement")) return "Bank Statement";
  if (dt.includes("lease")) return "Lease";
  if (dt.includes("invoice")) return "Invoice";
  if (dt === "unknown") return "Unclassified";
  return docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getDocTypeIcon(docType: string | null): string {
  const dt = (docType || "").toLowerCase();
  if (dt.includes("tax")) return "receipt_long";
  if (dt.includes("income") || dt.includes("balance") || dt.includes("financial")) return "account_balance";
  if (dt.includes("bank")) return "account_balance_wallet";
  if (dt.includes("lease")) return "home_work";
  if (dt.includes("invoice")) return "description";
  return "insert_drive_file";
}

// getConfidenceColor replaced by ConfidenceBadge component (shared thresholds)

type Props = {
  dealId: string;
};

export function OcrExtractedDataPanel({ dealId }: Props) {
  const [data, setData] = useState<OcrSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [runningOcr, setRunningOcr] = useState(false);
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/deals/${dealId}/ocr/summary`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setData(json);
        setError(null);
      } else {
        setError(json.error || "Failed to load OCR data");
      }
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const runOcrRecognition = async () => {
    setRunningOcr(true);
    setOcrMessage("Starting document recognition...");
    try {
      const res = await fetch(`/api/deals/${dealId}/documents/intel/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          limit: 15,
          scanLimit: 500,
          fast: true,
          preferPdfText: true,
          minPdfTextChars: 700,
          maxPages: 10,
        }),
      });
      const json = await res.json();
      
      if (json.ok) {
        const status = json.status === "complete" ? "Complete" : "In Progress";
        setOcrMessage(
          `✅ OCR ${status}: ${json.processed || 0} processed, ${json.stamped || 0} classified. ` +
          `${json.totals?.remainingDocs || 0} remaining.`
        );
        // Refresh data after OCR
        await fetchData();
      } else {
        setOcrMessage(`❌ OCR failed: ${json.error || "Unknown error"}`);
      }
    } catch (e: any) {
      setOcrMessage(`❌ Error: ${e?.message || "Network error"}`);
    } finally {
      setRunningOcr(false);
    }
  };

  if (loading) {
    return (
      <div className={cn(glassPanel, "overflow-hidden")}>
        <div className={glassHeader}>
          <span className="text-xs font-bold uppercase tracking-widest text-white/50">OCR & Document Intel</span>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-2 text-white/40 text-sm">
            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
            Loading extracted data...
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cn(glassPanel, "overflow-hidden")}>
        <div className={glassHeader}>
          <span className="text-xs font-bold uppercase tracking-widest text-white/50">OCR & Document Intel</span>
        </div>
        <div className="p-4">
          <div className="text-amber-300 text-sm">{error || "No data available"}</div>
          <button
            onClick={fetchData}
            className="mt-2 text-xs text-white/60 hover:text-white/80 underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { stats, financialData, documents } = data;
  const hasDocuments = stats.totalDocuments > 0;
  const ocrProgress = stats.totalDocuments > 0 
    ? Math.round((stats.documentsClassified / stats.totalDocuments) * 100)
    : 0;

  return (
    <div className={cn(glassPanel, "overflow-hidden")}>
      <div className={glassHeader}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-violet-400 text-[18px]">document_scanner</span>
            <span className="text-xs font-bold uppercase tracking-widest text-white/50">OCR & Document Intel</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runOcrRecognition}
              disabled={runningOcr}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                runningOcr
                  ? "bg-violet-500/20 text-violet-300 animate-pulse"
                  : "bg-violet-500/20 hover:bg-violet-500/30 text-violet-200"
              )}
            >
              <span className={cn("material-symbols-outlined text-[14px]", runningOcr && "animate-spin")}>
                {runningOcr ? "progress_activity" : "smart_toy"}
              </span>
              {runningOcr ? "Running..." : "Run OCR"}
            </button>
            <button
              onClick={fetchData}
              className="text-white/40 hover:text-white/70 transition-colors"
              title="Refresh"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* OCR Message */}
        {ocrMessage && (
          <div className={cn(
            "rounded-lg px-3 py-2 text-xs",
            ocrMessage.startsWith("✅") 
              ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-200"
              : ocrMessage.startsWith("❌")
              ? "bg-red-500/10 border border-red-500/20 text-red-200"
              : "bg-blue-500/10 border border-blue-500/20 text-blue-200"
          )}>
            {ocrMessage}
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center">
            <div className="text-2xl font-bold text-white">{stats.totalDocuments}</div>
            <div className="text-[10px] text-white/40">Total Docs</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-sky-300">{stats.documentsWithOcr}</div>
            <div className="text-[10px] text-white/40">OCR'd</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-emerald-300">{stats.documentsClassified}</div>
            <div className="text-[10px] text-white/40">Classified</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-300">{stats.documentsUnknown}</div>
            <div className="text-[10px] text-white/40">Unknown</div>
          </div>
        </div>

        {/* Progress Bar */}
        {hasDocuments && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-white/50">
              <span>Classification Progress</span>
              <span>{ocrProgress}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all duration-500"
                style={{ width: `${ocrProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Financial Data Summary */}
        {hasDocuments && (
          <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
            <div className="text-xs font-semibold text-white/70 mb-2">Extracted Financial Data</div>
            
            {/* Tax Years */}
            {financialData.taxYears.length > 0 && (
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-amber-400 text-[14px]">calendar_today</span>
                <span className="text-xs text-white/60">Tax Years:</span>
                <div className="flex gap-1">
                  {financialData.taxYears.slice(0, 5).map((year) => (
                    <span
                      key={year}
                      className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 text-[10px] font-mono"
                    >
                      {year}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Document Type Counts */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              {financialData.businessTaxReturns > 0 && (
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-blue-400 text-[14px]">receipt_long</span>
                  <span className="text-white/60">{financialData.businessTaxReturns} Business Tax</span>
                </div>
              )}
              {financialData.personalTaxReturns > 0 && (
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-green-400 text-[14px]">receipt_long</span>
                  <span className="text-white/60">{financialData.personalTaxReturns} Personal Tax</span>
                </div>
              )}
              {financialData.financialStatements > 0 && (
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-purple-400 text-[14px]">account_balance</span>
                  <span className="text-white/60">{financialData.financialStatements} Financials</span>
                </div>
              )}
              {financialData.bankStatements > 0 && (
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-cyan-400 text-[14px]">account_balance_wallet</span>
                  <span className="text-white/60">{financialData.bankStatements} Bank Stmts</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* No Documents Warning */}
        {!hasDocuments && (
          <div className="text-center py-4 text-white/40 text-sm">
            <span className="material-symbols-outlined text-[32px] mb-2 block">cloud_upload</span>
            No documents uploaded yet.
            <br />
            <span className="text-xs">Upload PDFs to extract financial data.</span>
          </div>
        )}

        {/* Expandable Document List */}
        {hasDocuments && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center justify-between text-xs text-white/50 hover:text-white/70 transition-colors py-1"
            >
              <span>View All Documents ({documents.length})</span>
              <span
                className="material-symbols-outlined text-[14px] transition-transform"
                style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
              >
                expand_more
              </span>
            </button>

            {expanded && (
              <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/5"
                  >
                    <span className={cn(
                      "material-symbols-outlined text-[16px]",
                      doc.hasOcr ? "text-emerald-400" : "text-white/30"
                    )}>
                      {getDocTypeIcon(doc.docType)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white/80 truncate">{doc.filename}</div>
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className={cn(
                          doc.docType && doc.docType !== "Unknown" ? "text-white/60" : "text-amber-400/60"
                        )}>
                          {formatDocType(doc.docType)}
                        </span>
                        {doc.docYear && (
                          <span className="text-white/40">• {doc.docYear}</span>
                        )}
                        {doc.confidence !== null && (
                          <ConfidenceBadge confidence={doc.confidence} />
                        )}
                      </div>
                    </div>
                    {doc.hasOcr ? (
                      <span className="text-[10px] text-emerald-400/60">OCR ✓</span>
                    ) : (
                      <span className="text-[10px] text-white/30">No OCR</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
