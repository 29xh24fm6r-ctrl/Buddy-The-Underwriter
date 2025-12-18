export type PackDocument = {
  source: {
    job_id: string;
    file_id?: string;
    stored_name?: string;
  };
  doc_id: string;
  filename: string;
  file_name?: string;
  title?: string;
  doc_type: string;
  confidence: number;
  year?: number;
  pages?: number;
  reasons?: string[];
  entity_hints?: {
    borrower?: string;
    issuer?: string;
  };
  classification?: any;
  // NEW: Entity assignment
  entity_id?: string;
  entity_name?: string;
};

export type PackIndex = {
  packId: string;
  allDocs: PackDocument[];
  taxReturns?: {
    byYear: Record<string, { docs: PackDocument[] }>;
  };
  pfs?: { docs: PackDocument[] };
  businessFinancials?: { docs: PackDocument[] };
  other?: { docs: PackDocument[] };
  missingDocuments: string[];
  recommendations: string[];
};

export type BuildPackIndexOptions = {
  jobs: Array<{
    job_id: string;
    pack_id?: string;
    stored_name?: string;
    entity_id?: string;
    result?: any;
  }>;
  entityFilter?: string | null; // Filter by entity_id, or null for GROUP view (all docs)
};

export function buildPackIndex(
  jobsOrOptions: Array<{
    job_id: string;
    pack_id?: string;
    stored_name?: string;
    entity_id?: string;
    result?: any;
  }> | BuildPackIndexOptions
): PackIndex | null {
  // Support both legacy array input and new options object
  const jobs = Array.isArray(jobsOrOptions) ? jobsOrOptions : jobsOrOptions.jobs;
  const entityFilter = Array.isArray(jobsOrOptions) ? undefined : jobsOrOptions.entityFilter;
  // Group jobs by pack_id
  let packJobs = jobs.filter(job => job.pack_id);
  
  // Apply entity filter if specified
  if (entityFilter !== undefined) {
    if (entityFilter === null) {
      // null = GROUP view, show all docs
      // Keep all packJobs
    } else {
      // Filter to specific entity
      packJobs = packJobs.filter(job => job.entity_id === entityFilter);
    }
  }
  
  if (packJobs.length === 0) return null;

  const packId = packJobs[0].pack_id!;
  const allDocs: PackDocument[] = [];
  const taxReturnsByYear: Record<string, PackDocument[]> = {};
  const pfs: PackDocument[] = [];
  const businessFinancials: PackDocument[] = [];
  const other: PackDocument[] = [];

  for (const job of packJobs) {
    if (!job.result?.classification) continue;

    const classification = job.result.classification;
    const doc: PackDocument = {
      source: {
        job_id: job.job_id,
        stored_name: job.stored_name,
      },
      doc_id: job.job_id, // Use job_id as doc_id for now
      filename: job.stored_name || 'unknown',
      // NEW: Include entity assignment
      entity_id: job.entity_id,
      file_name: job.stored_name,
      title: job.stored_name,
      doc_type: classification.doc_type,
      confidence: classification.confidence,
      year: classification.tax_year ? parseInt(String(classification.tax_year)) : undefined,
      pages: job.result?.pages,
      reasons: classification.reasons,
      entity_hints: {
        borrower: classification.borrower?.name,
        issuer: classification.issuer_hint,
      },
      classification,
    };

    allDocs.push(doc);

    // Categorize documents
    if (classification.doc_type === 'PFS') {
      pfs.push(doc);
    } else if (classification.doc_type === 'FINANCIAL_STATEMENT') {
      businessFinancials.push(doc);
    } else if (['IRS_1040', 'IRS_1065', 'IRS_1120', 'IRS_1120S', 'K1'].includes(classification.doc_type)) {
      const yearKey = doc.year ? String(doc.year) : 'unknown';
      if (!taxReturnsByYear[yearKey]) {
        taxReturnsByYear[yearKey] = [];
      }
      taxReturnsByYear[yearKey].push(doc);
    } else {
      other.push(doc);
    }
  }

  // Build missing documents and recommendations
  const missingDocuments: string[] = [];
  const recommendations: string[] = [];

  if (pfs.length === 0) {
    missingDocuments.push("Personal Financial Statement (PFS)");
    recommendations.push("Upload PFS to complete borrower financial picture");
  }

  if (businessFinancials.length === 0) {
    missingDocuments.push("Business Financial Statements");
    recommendations.push("Upload business financial statements for complete analysis");
  }

  if (Object.keys(taxReturnsByYear).length === 0) {
    missingDocuments.push("Tax Returns");
    recommendations.push("Upload tax returns for income verification");
  }

  return {
    packId,
    allDocs,
    taxReturns: {
      byYear: Object.fromEntries(
        Object.entries(taxReturnsByYear).map(([year, docs]) => [year, { docs }])
      ),
    },
    pfs: { docs: pfs },
    businessFinancials: { docs: businessFinancials },
    other: { docs: other },
    missingDocuments,
    recommendations,
  };
}