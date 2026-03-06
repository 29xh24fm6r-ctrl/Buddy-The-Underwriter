export type CorrectionEvent = {
  id: string;
  dealId: string;
  documentId: string;
  documentType: string;
  taxYear: number | null;
  naicsCode: string | null;
  factKey: string;
  originalValue: number | null;
  correctedValue: number | null;
  correctionSource: "ANALYST_MANUAL" | "CORPUS_OVERRIDE" | "RE_EXTRACTION";
  analystId: string | null;
  correctedAt: string;
};

export type CorrectionPattern = {
  factKey: string;
  documentType: string;
  correctionCount: number;
  errorRate: number; // corrections / total extractions for this key+docType
  avgDelta: number | null; // average magnitude of corrections
  trend: "IMPROVING" | "STABLE" | "DEGRADING";
  lastSeen: string;
  flaggedForReview: boolean; // true when errorRate > 0.05 (5%)
};
