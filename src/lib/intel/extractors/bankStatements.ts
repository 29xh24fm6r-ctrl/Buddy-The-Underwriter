/**
 * Example Bank Statement Extractor
 * 
 * This is a reference implementation to help you build your actual extractor.
 * Replace placeholder logic with your business rules.
 */

export function extractBankFeesProducts(tokens: string): {
  kind: string;
  confidence: number;
  fields: any;
  tables?: any[];
  evidence?: any[];
} {
  const lower = tokens.toLowerCase();
  const lines = tokens.split('\n');

  // Check if this looks like a bank statement
  const isBankStatement = 
    lower.includes('statement') && 
    (lower.includes('account') || lower.includes('checking') || lower.includes('savings'));

  if (!isBankStatement) {
    return { kind: "BANK_STATEMENTS", confidence: 0.0, fields: {} };
  }

  // Extract fees
  const fees: Array<{ name: string; amount: number; evidence: string }> = [];
  const feePatterns = [
    /(?:monthly|maintenance|service)\s+fee[:\s]+\$?(\d+(?:\.\d{2})?)/gi,
    /(\d+(?:\.\d{2})?)\s+(?:monthly|maintenance|service)\s+fee/gi,
  ];

  for (const pattern of feePatterns) {
    let match;
    while ((match = pattern.exec(tokens)) !== null) {
      const amount = parseFloat(match[1]);
      fees.push({
        name: "Monthly Maintenance Fee",
        amount,
        evidence: match[0],
      });
    }
  }

  // Extract products (checking, savings, credit card, etc.)
  const products: string[] = [];
  if (lower.includes('checking')) products.push('Checking Account');
  if (lower.includes('savings')) products.push('Savings Account');
  if (lower.includes('credit card')) products.push('Credit Card');
  if (lower.includes('line of credit') || lower.includes('loc')) products.push('Line of Credit');

  // Estimate monthly pricing (sum of fees)
  const monthlyPricing = fees.reduce((sum, fee) => sum + fee.amount, 0);

  const confidence = fees.length > 0 || products.length > 0 ? 0.8 : 0.5;

  return {
    kind: "BANK_STATEMENTS",
    confidence,
    fields: {
      fees_detected: fees,
      products_detected: [...new Set(products)],
      monthly_pricing: monthlyPricing > 0 ? monthlyPricing : null,
    },
    tables: [],
    evidence: fees.map(f => ({
      type: "fee",
      text: f.evidence,
      value: f.amount,
    })),
  };
}
