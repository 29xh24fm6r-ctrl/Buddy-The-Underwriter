/**
 * MEGA STEP 9: Draft Request Generator
 * 
 * Maps missing CTC conditions → document types → draft borrower requests
 * 
 * Rules (no LLM):
 * 1. Read outstanding critical/high conditions
 * 2. Match to known document type patterns
 * 3. Generate draft email with evidence
 * 4. Drop into pending_approval queue
 * 5. Underwriter reviews before sending
 * 
 * Deterministic: same missing condition → same draft every time
 */

interface Condition {
  id: string;
  deal_id: string;
  category: string;
  item_name: string;
  item_description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  outstanding: boolean;
  resolution_evidence: any;
}

interface DraftRequest {
  deal_id: string;
  condition_id: string;
  missing_document_type: string;
  draft_subject: string;
  draft_message: string;
  evidence: any[];
}

/**
 * Document type patterns (deterministic matching)
 */
const DOCUMENT_PATTERNS = {
  tax_return: [
    /tax return/i,
    /1040/i,
    /business tax/i,
    /personal tax/i,
    /federal tax/i,
  ],
  bank_statement: [
    /bank statement/i,
    /account statement/i,
    /banking/i,
  ],
  financial_statement: [
    /financial statement/i,
    /balance sheet/i,
    /income statement/i,
    /p&l/i,
    /profit.*loss/i,
  ],
  lease: [
    /lease/i,
    /rental agreement/i,
  ],
  insurance: [
    /insurance/i,
    /coverage/i,
  ],
  business_license: [
    /business license/i,
    /operating license/i,
  ],
  articles_incorporation: [
    /articles of incorporation/i,
    /certificate of formation/i,
  ],
  personal_financial_statement: [
    /personal financial/i,
    /pfs/i,
  ],
};

/**
 * Match condition to document type (deterministic)
 */
function matchDocumentType(condition: Condition): string | null {
  const text = `${condition.item_name} ${condition.item_description}`.toLowerCase();
  
  for (const [docType, patterns] of Object.entries(DOCUMENT_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return docType;
      }
    }
  }
  
  return null; // Unknown document type → skip
}

/**
 * Generate draft subject line (deterministic templates)
 */
function generateSubject(docType: string, dealName: string): string {
  const templates: Record<string, string> = {
    tax_return: `Action Required: Tax Returns for ${dealName}`,
    bank_statement: `Action Required: Bank Statements for ${dealName}`,
    financial_statement: `Action Required: Financial Statements for ${dealName}`,
    lease: `Action Required: Lease Agreement for ${dealName}`,
    insurance: `Action Required: Insurance Documentation for ${dealName}`,
    business_license: `Action Required: Business License for ${dealName}`,
    articles_incorporation: `Action Required: Articles of Incorporation for ${dealName}`,
    personal_financial_statement: `Action Required: Personal Financial Statement for ${dealName}`,
  };
  
  return templates[docType] || `Action Required: Additional Documents for ${dealName}`;
}

/**
 * Generate draft message (deterministic templates)
 */
function generateMessage(
  docType: string,
  condition: Condition,
  borrowerName: string
): string {
  const templates: Record<string, string> = {
    tax_return: `Dear ${borrowerName},

To continue processing your loan application, we need your business and personal tax returns.

Required Documents:
• Last 3 years of business tax returns (complete with all schedules)
• Last 3 years of personal tax returns (complete with all schedules)

Why we need this:
${condition.item_description || 'Tax returns verify income and business performance required for SBA loan approval.'}

Please upload these documents through your borrower portal at your earliest convenience.

Thank you for your cooperation.`,

    bank_statement: `Dear ${borrowerName},

To continue processing your loan application, we need your recent bank statements.

Required Documents:
• Last 6 months of business bank statements (all accounts)
• Last 2 months of personal bank statements

Why we need this:
${condition.item_description || 'Bank statements verify cash flow and financial stability required for loan approval.'}

Please upload these documents through your borrower portal at your earliest convenience.

Thank you for your cooperation.`,

    financial_statement: `Dear ${borrowerName},

To continue processing your loan application, we need your financial statements.

Required Documents:
• Year-to-date Profit & Loss statement
• Year-to-date Balance Sheet
• Prior year-end financial statements

Why we need this:
${condition.item_description || 'Financial statements verify business performance and financial position.'}

Please upload these documents through your borrower portal at your earliest convenience.

Thank you for your cooperation.`,
  };
  
  // Default template for unknown types
  const defaultTemplate = `Dear ${borrowerName},

To continue processing your loan application, we need additional documentation.

Required: ${condition.item_name}

${condition.item_description || 'This document is required to complete your loan application review.'}

Please upload these documents through your borrower portal at your earliest convenience.

Thank you for your cooperation.`;
  
  return templates[docType] || defaultTemplate;
}

/**
 * Generate draft requests from conditions
 * Returns array of draft requests ready to insert
 */
export function generateDraftRequests(
  conditions: Condition[],
  dealName: string,
  borrowerName: string
): DraftRequest[] {
  const drafts: DraftRequest[] = [];
  
  // Only process critical/high outstanding conditions
  const eligibleConditions = conditions.filter(
    c => c.outstanding && (c.severity === 'CRITICAL' || c.severity === 'HIGH')
  );
  
  for (const condition of eligibleConditions) {
    const docType = matchDocumentType(condition);
    if (!docType) continue; // Skip unknown types
    
    const draft: DraftRequest = {
      deal_id: condition.deal_id,
      condition_id: condition.id,
      missing_document_type: docType,
      draft_subject: generateSubject(docType, dealName),
      draft_message: generateMessage(docType, condition, borrowerName),
      evidence: [
        `Condition: ${condition.item_name}`,
        `Severity: ${condition.severity}`,
        `Category: ${condition.category}`,
        condition.resolution_evidence ? `Evidence: ${JSON.stringify(condition.resolution_evidence)}` : null,
      ].filter(Boolean),
    };
    
    drafts.push(draft);
  }
  
  return drafts;
}

/**
 * Deduplicate drafts by document type
 * If multiple conditions need same doc type, create single draft
 */
export function deduplicateDrafts(drafts: DraftRequest[]): DraftRequest[] {
  const seen = new Set<string>();
  const unique: DraftRequest[] = [];
  
  for (const draft of drafts) {
    const key = `${draft.deal_id}:${draft.missing_document_type}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(draft);
    }
  }
  
  return unique;
}
