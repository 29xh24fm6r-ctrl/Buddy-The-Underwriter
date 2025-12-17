

type Classification = {
  doc_type: string;
  confidence: number;
  tax_year: string | null;
  tags?: string[];
  reasons?: string[];
};

type AnalysisResult = {
  classification?: Classification | null;
  raw?: unknown;
  c4?: unknown;
  text_preview?: unknown;
};

// src/lib/finance/underwriting/documentCoverage.ts


export type DocumentCoverage = {
  taxReturns: Record<number, {
    present: boolean;
    confidence: number;
    source: string;
  }>;
  pfs: {
    present: boolean;
    confidence: number;
    source?: string;
  };
  businessFinancials: {
    present: boolean;
    years: number[];
    confidence: number;
    source?: string;
  };
  debtSchedule: {
    present: boolean;
    confidence: number;
    source?: string;
  };
  leaseEvidence: {
    present: boolean;
    confidence: number;
    source?: string;
  };
  missingDocuments: string[];
  recommendations: string[];
};

export function analyzeDocumentCoverage(
  results: Record<string, AnalysisResult>,
  taxYears: number[]
): DocumentCoverage {
  const coverage: DocumentCoverage = {
    taxReturns: {},
    pfs: { present: false, confidence: 0 },
    businessFinancials: { present: false, years: [], confidence: 0 },
    debtSchedule: { present: false, confidence: 0 },
    leaseEvidence: { present: false, confidence: 0 },
    missingDocuments: [],
    recommendations: [],
  };

  // Initialize tax return coverage
  taxYears.forEach(year => {
    coverage.taxReturns[year] = {
      present: false,
      confidence: 0,
      source: '',
    };
  });

  // Analyze each document
  Object.entries(results).forEach(([storedName, result]) => {
    const classification = result.classification;
    if (!classification) return;

    const docType = classification.doc_type;
    const confidence = classification.confidence / 100; // Convert to 0-1 scale

    // Tax returns
    if (docType.startsWith('IRS_')) {
      const taxYear = classification.tax_year;
      if (taxYear) {
        const year = parseInt(taxYear);
        if (coverage.taxReturns[year]) {
          coverage.taxReturns[year] = {
            present: true,
            confidence: Math.max(coverage.taxReturns[year].confidence, confidence),
            source: storedName,
          };
        }
      }
    }

    // PFS
    if (docType === 'PFS') {
      coverage.pfs = {
        present: true,
        confidence: Math.max(coverage.pfs.confidence, confidence),
        source: storedName,
      };
    }

    // Business financial statements
    if (docType === 'FINANCIAL_STATEMENT') {
      coverage.businessFinancials.present = true;
      coverage.businessFinancials.confidence = Math.max(
        coverage.businessFinancials.confidence,
        confidence
      );
      coverage.businessFinancials.source = storedName;

      // Try to extract year from text or classification
      const text = String(result.text_preview || '');
      const yearMatch = text.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1]);
        if (!coverage.businessFinancials.years.includes(year)) {
          coverage.businessFinancials.years.push(year);
        }
      }
    }

    // Debt schedule evidence (look for debt-related keywords)
    const text = String(result.text_preview || '').toLowerCase();
    if (text.includes('debt') || text.includes('loan') || text.includes('note') ||
        text.includes('mortgage') || text.includes('lien') || docType === 'BANK_STATEMENT') {
      coverage.debtSchedule.present = true;
      coverage.debtSchedule.confidence = Math.max(
        coverage.debtSchedule.confidence,
        confidence * 0.8 // Slightly lower confidence for inferred docs
      );
      coverage.debtSchedule.source = storedName;
    }

    // Lease evidence
    if (docType === 'LEASE' || text.includes('lease') || text.includes('rent')) {
      coverage.leaseEvidence.present = true;
      coverage.leaseEvidence.confidence = Math.max(
        coverage.leaseEvidence.confidence,
        confidence
      );
      coverage.leaseEvidence.source = storedName;
    }
  });

  // Generate missing documents list and recommendations
  const missing: string[] = [];
  const recommendations: string[] = [];

  // Check tax returns
  const missingTaxYears = taxYears.filter(year => !coverage.taxReturns[year].present);
  if (missingTaxYears.length > 0) {
    missing.push(`${missingTaxYears.length} tax return(s) missing: ${missingTaxYears.join(', ')}`);
    recommendations.push('Upload missing tax returns for complete financial history');
  }

  // Check PFS
  if (!coverage.pfs.present) {
    missing.push('Personal Financial Statement (PFS)');
    recommendations.push('PFS required for global cash flow analysis and owner financial strength');
  }

  // Check business financials
  if (!coverage.businessFinancials.present) {
    missing.push('Business Financial Statements');
    recommendations.push('Business financial statements provide additional validation of tax return data');
  }

  // Check debt schedule
  if (!coverage.debtSchedule.present) {
    missing.push('Debt Schedule Documentation');
    recommendations.push('Debt schedule evidence needed to validate DSCR calculations');
  }

  // Check lease evidence (if business has real estate)
  // This would need more sophisticated detection, but for now we'll assume it's optional

  coverage.missingDocuments = missing;
  coverage.recommendations = recommendations;

  return coverage;
}