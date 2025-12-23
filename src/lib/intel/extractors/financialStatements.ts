/**
 * Example Financial Statement Extractor
 * 
 * This is a reference implementation to help you build your actual extractor.
 * Replace placeholder logic with your business rules.
 */

export function extractFinancialStatements(tokens: string): {
  kind: string;
  confidence: number;
  fields: any;
  tables?: any[];
  evidence?: any[];
} {
  const lower = tokens.toLowerCase();
  const lines = tokens.split('\n').map(l => l.trim()).filter(Boolean);

  // Check if this looks like a financial statement
  const isBalanceSheet = lower.includes('balance sheet');
  const isIncomeStatement = 
    lower.includes('income statement') || 
    lower.includes('profit and loss') ||
    lower.includes('p&l') ||
    lower.includes('p & l');

  if (!isBalanceSheet && !isIncomeStatement) {
    return { kind: "FINANCIAL_STATEMENTS", confidence: 0.0, fields: {} };
  }

  // Extract periods/years
  const yearPattern = /\b(20\d{2})\b/g;
  const years = new Set<number>();
  let match;
  while ((match = yearPattern.exec(tokens)) !== null) {
    const year = parseInt(match[1], 10);
    if (year >= 2015 && year <= 2030) {
      years.add(year);
    }
  }

  const periods = Array.from(years).sort((a, b) => b - a);

  // Determine statement type
  const statementType = isBalanceSheet ? 'Balance Sheet' : 'Income Statement';

  // Extract key line items (example - you'd do this more robustly)
  const keyItems: Array<{ label: string; values: number[] }> = [];

  if (isBalanceSheet) {
    // Look for assets, liabilities, equity
    const assetMatch = /total\s+assets[:\s]+\$?\s*([\d,]+(?:\.\d{2})?)/i.exec(tokens);
    const liabilityMatch = /total\s+liabilities[:\s]+\$?\s*([\d,]+(?:\.\d{2})?)/i.exec(tokens);

    if (assetMatch) {
      keyItems.push({
        label: 'Total Assets',
        values: [parseFloat(assetMatch[1].replace(/,/g, ''))],
      });
    }
    if (liabilityMatch) {
      keyItems.push({
        label: 'Total Liabilities',
        values: [parseFloat(liabilityMatch[1].replace(/,/g, ''))],
      });
    }
  } else if (isIncomeStatement) {
    // Look for revenue, expenses, net income
    const revenueMatch = /(?:total\s+)?revenue[:\s]+\$?\s*([\d,]+(?:\.\d{2})?)/i.exec(tokens);
    const netIncomeMatch = /net\s+income[:\s]+\$?\s*([\d,]+(?:\.\d{2})?)/i.exec(tokens);

    if (revenueMatch) {
      keyItems.push({
        label: 'Total Revenue',
        values: [parseFloat(revenueMatch[1].replace(/,/g, ''))],
      });
    }
    if (netIncomeMatch) {
      keyItems.push({
        label: 'Net Income',
        values: [parseFloat(netIncomeMatch[1].replace(/,/g, ''))],
      });
    }
  }

  const confidence = periods.length > 0 && keyItems.length > 0 ? 0.85 : 0.6;

  return {
    kind: "FINANCIAL_STATEMENTS",
    confidence,
    fields: {
      statement_type: statementType,
      periods,
      key_items: keyItems,
      multi_period: periods.length > 1,
    },
    tables: [],
    evidence: keyItems.map(item => ({
      type: "financial_line_item",
      label: item.label,
      values: item.values,
    })),
  };
}
