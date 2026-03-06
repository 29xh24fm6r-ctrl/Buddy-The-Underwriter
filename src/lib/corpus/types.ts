export type CorpusDocument = {
  id: string; // stable identifier, e.g. "samaritus_2022_1065"
  displayName: string;
  formType: string;
  taxYear: number;
  naicsCode: string | null;
  industry: string;
  groundTruth: Record<string, number | null>; // canonicalKey → expected value
  tolerances?: Record<string, number>; // per-key tolerance, default $1
  notes: string; // why this document is in the corpus
};

export type CorpusTestResult = {
  documentId: string;
  passed: boolean;
  failures: Array<{
    factKey: string;
    expected: number | null;
    actual: number | null;
    delta: number | null;
    tolerance: number;
  }>;
  testedAt: string;
};
