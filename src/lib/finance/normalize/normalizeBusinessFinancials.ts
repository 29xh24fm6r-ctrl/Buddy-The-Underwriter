// src/lib/finance/normalize/normalizeBusinessFinancials.ts

export type BusinessFinancialsNormalized = {
  year: number;

  // Income Statement
  revenue: number;
  costOfGoodsSold: number;
  grossProfit: number;
  operatingExpenses: number;
  ebitda: number;
  netIncome: number;

  // Balance Sheet
  cash: number;
  accountsReceivable: number;
  inventory: number;
  otherCurrentAssets: number;
  totalCurrentAssets: number;

  propertyPlantEquipment: number;
  otherAssets: number;
  totalAssets: number;

  accountsPayable: number;
  accruedExpenses: number;
  currentDebt: number;
  totalCurrentLiabilities: number;

  longTermDebt: number;
  otherLiabilities: number;
  totalLiabilities: number;

  equity: number;

  // Ratios
  currentRatio?: number;
  quickRatio?: number;
  debtToEquity?: number;
  returnOnAssets?: number;
  grossMargin?: number;
  operatingMargin?: number;
};

export function normalizeBusinessFinancialsFromC4(c4: unknown, year: number): BusinessFinancialsNormalized | null {
  if (!c4 || typeof c4 !== 'object') return null;

  // Initialize with zeros
  const normalized: BusinessFinancialsNormalized = {
    year,
    revenue: 0,
    costOfGoodsSold: 0,
    grossProfit: 0,
    operatingExpenses: 0,
    ebitda: 0,
    netIncome: 0,
    cash: 0,
    accountsReceivable: 0,
    inventory: 0,
    otherCurrentAssets: 0,
    totalCurrentAssets: 0,
    propertyPlantEquipment: 0,
    otherAssets: 0,
    totalAssets: 0,
    accountsPayable: 0,
    accruedExpenses: 0,
    currentDebt: 0,
    totalCurrentLiabilities: 0,
    longTermDebt: 0,
    otherLiabilities: 0,
    totalLiabilities: 0,
    equity: 0,
  };

  try {
    // This would need to be implemented based on the actual C4 structure
    // For now, return a basic structure
    // In a real implementation, you'd parse the C4 JSON structure for financial statements

    // Calculate derived fields
    normalized.grossProfit = normalized.revenue - normalized.costOfGoodsSold;
    normalized.totalCurrentAssets =
      normalized.cash +
      normalized.accountsReceivable +
      normalized.inventory +
      normalized.otherCurrentAssets;

    normalized.totalAssets =
      normalized.totalCurrentAssets +
      normalized.propertyPlantEquipment +
      normalized.otherAssets;

    normalized.totalCurrentLiabilities =
      normalized.accountsPayable +
      normalized.accruedExpenses +
      normalized.currentDebt;

    normalized.totalLiabilities =
      normalized.totalCurrentLiabilities +
      normalized.longTermDebt +
      normalized.otherLiabilities;

    normalized.equity = normalized.totalAssets - normalized.totalLiabilities;

    // Calculate ratios
    if (normalized.totalCurrentLiabilities > 0) {
      normalized.currentRatio = normalized.totalCurrentAssets / normalized.totalCurrentLiabilities;
      normalized.quickRatio = (normalized.cash + normalized.accountsReceivable) / normalized.totalCurrentLiabilities;
    }

    if (normalized.equity > 0) {
      normalized.debtToEquity = normalized.totalLiabilities / normalized.equity;
    }

    if (normalized.totalAssets > 0) {
      normalized.returnOnAssets = normalized.netIncome / normalized.totalAssets;
    }

    if (normalized.revenue > 0) {
      normalized.grossMargin = normalized.grossProfit / normalized.revenue;
      normalized.operatingMargin = normalized.ebitda / normalized.revenue;
    }

    return normalized;
  } catch (error) {
    console.error('Error normalizing business financials:', error);
    return null;
  }
}