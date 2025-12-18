// src/lib/finance/combined/aggregate.ts
// Combined spread aggregation across multiple entities

import type { EntityFinancialPeriod, CombinedSpread, DealEntity } from "@/lib/entities/types";

export type AggregationInput = {
  entity_periods: EntityFinancialPeriod[];
  entities: DealEntity[];
  fiscal_year: number;
  period_type: 'ANNUAL' | 'INTERIM' | 'TTM';
};

export type AggregationResult = {
  combined_statement: any;
  flags: {
    intercompany_present: boolean;
    missing_entities: string[];
    mismatched_periods: string[];
    warnings: string[];
  };
};

/**
 * Aggregate financial statements across multiple entities
 */
export function aggregateEntityFinancials(input: AggregationInput): AggregationResult {
  const { entity_periods, entities, fiscal_year, period_type } = input;
  
  const flags = {
    intercompany_present: false,
    missing_entities: [] as string[],
    mismatched_periods: [] as string[],
    warnings: [] as string[],
  };
  
  // Check for missing entities
  const periodEntityIds = new Set(entity_periods.map(p => p.entity_id));
  const expectedEntityIds = entities
    .filter(e => e.entity_kind !== 'GROUP')
    .map(e => e.id);
  
  for (const entityId of expectedEntityIds) {
    if (!periodEntityIds.has(entityId)) {
      const entity = entities.find(e => e.id === entityId);
      if (entity) {
        flags.missing_entities.push(entity.name);
        flags.warnings.push(`Missing ${period_type} statement for ${entity.name} (${fiscal_year})`);
      }
    }
  }
  
  // Initialize combined statement structure
  const combined: any = {
    pnl: {
      revenue: 0,
      cogs: 0,
      gross_profit: 0,
      operating_expenses: 0,
      operating_income: 0,
      interest_expense: 0,
      net_income: 0,
      by_entity: {},
    },
    balanceSheet: {
      total_assets: 0,
      total_liabilities: 0,
      total_equity: 0,
      by_entity: {},
    },
    cashFlow: {
      operating_activities: 0,
      investing_activities: 0,
      financing_activities: 0,
      by_entity: {},
    },
  };
  
  // Aggregate each entity's financials
  for (const period of entity_periods) {
    const entity = entities.find(e => e.id === period.entity_id);
    if (!entity) continue;
    
    const statement = period.statement;
    if (!statement) continue;
    
    // Check for mismatched fiscal year ends
    if (period.fiscal_year_end && entity_periods.length > 1) {
      const otherPeriods = entity_periods.filter(p => p.id !== period.id && p.fiscal_year_end);
      if (otherPeriods.length > 0 && otherPeriods.some(p => p.fiscal_year_end !== period.fiscal_year_end)) {
        flags.mismatched_periods.push(entity.name);
        flags.warnings.push(
          `${entity.name} has different fiscal year end (${period.fiscal_year_end}) than other entities`
        );
      }
    }
    
    // Aggregate P&L
    if (statement.pnl) {
      const pnl = statement.pnl;
      
      combined.pnl.revenue += parseFloat(pnl.revenue || 0);
      combined.pnl.cogs += parseFloat(pnl.cogs || 0);
      combined.pnl.gross_profit += parseFloat(pnl.gross_profit || 0);
      combined.pnl.operating_expenses += parseFloat(pnl.operating_expenses || 0);
      combined.pnl.operating_income += parseFloat(pnl.operating_income || 0);
      combined.pnl.interest_expense += parseFloat(pnl.interest_expense || 0);
      combined.pnl.net_income += parseFloat(pnl.net_income || 0);
      
      combined.pnl.by_entity[entity.name] = {
        revenue: parseFloat(pnl.revenue || 0),
        net_income: parseFloat(pnl.net_income || 0),
      };
    }
    
    // Aggregate Balance Sheet
    if (statement.balanceSheet) {
      const bs = statement.balanceSheet;
      
      combined.balanceSheet.total_assets += parseFloat(bs.total_assets || 0);
      combined.balanceSheet.total_liabilities += parseFloat(bs.total_liabilities || 0);
      combined.balanceSheet.total_equity += parseFloat(bs.total_equity || 0);
      
      combined.balanceSheet.by_entity[entity.name] = {
        total_assets: parseFloat(bs.total_assets || 0),
        total_liabilities: parseFloat(bs.total_liabilities || 0),
        total_equity: parseFloat(bs.total_equity || 0),
      };
    }
    
    // Aggregate Cash Flow
    if (statement.cashFlow) {
      const cf = statement.cashFlow;
      
      combined.cashFlow.operating_activities += parseFloat(cf.operating_activities || 0);
      combined.cashFlow.investing_activities += parseFloat(cf.investing_activities || 0);
      combined.cashFlow.financing_activities += parseFloat(cf.financing_activities || 0);
      
      combined.cashFlow.by_entity[entity.name] = {
        operating_activities: parseFloat(cf.operating_activities || 0),
      };
    }
    
    // Check for intercompany accounts
    if (detectIntercompanyAccounts(statement)) {
      flags.intercompany_present = true;
      flags.warnings.push(
        `${entity.name} contains intercompany accounts (due to/from affiliates, IC receivables/payables)`
      );
    }
  }
  
  // Sanity checks
  if (combined.pnl.revenue < 0) {
    flags.warnings.push('Combined revenue is negative - check for data quality issues');
  }
  
  if (Math.abs(combined.balanceSheet.total_assets - (combined.balanceSheet.total_liabilities + combined.balanceSheet.total_equity)) > 1000) {
    flags.warnings.push('Balance sheet does not balance (Assets ≠ Liabilities + Equity)');
  }
  
  return {
    combined_statement: combined,
    flags,
  };
}

/**
 * Detect intercompany accounts in a financial statement
 */
function detectIntercompanyAccounts(statement: any): boolean {
  const checkKeys = (obj: any, patterns: string[]): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    
    for (const key of Object.keys(obj)) {
      const lowerKey = key.toLowerCase();
      for (const pattern of patterns) {
        if (lowerKey.includes(pattern)) return true;
      }
      
      // Recursive check
      if (typeof obj[key] === 'object') {
        if (checkKeys(obj[key], patterns)) return true;
      }
    }
    
    return false;
  };
  
  const intercompanyPatterns = [
    'intercompany',
    'inter_company',
    'inter company',
    'due_to_affiliate',
    'due_from_affiliate',
    'due to affiliate',
    'due from affiliate',
    'ic_receivable',
    'ic_payable',
    'related_party',
  ];
  
  return checkKeys(statement, intercompanyPatterns);
}

/**
 * Format combined statement for display
 */
export function formatCombinedStatement(combined: any): string {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };
  
  let output = '### Combined Financial Statement\n\n';
  
  // P&L
  if (combined.pnl) {
    output += '**Income Statement (P&L)**\n\n';
    output += `Revenue: ${formatCurrency(combined.pnl.revenue)}\n`;
    output += `COGS: ${formatCurrency(combined.pnl.cogs)}\n`;
    output += `Gross Profit: ${formatCurrency(combined.pnl.gross_profit)}\n`;
    output += `Operating Expenses: ${formatCurrency(combined.pnl.operating_expenses)}\n`;
    output += `Operating Income: ${formatCurrency(combined.pnl.operating_income)}\n`;
    output += `Net Income: ${formatCurrency(combined.pnl.net_income)}\n\n`;
  }
  
  // Balance Sheet
  if (combined.balanceSheet) {
    output += '**Balance Sheet**\n\n';
    output += `Total Assets: ${formatCurrency(combined.balanceSheet.total_assets)}\n`;
    output += `Total Liabilities: ${formatCurrency(combined.balanceSheet.total_liabilities)}\n`;
    output += `Total Equity: ${formatCurrency(combined.balanceSheet.total_equity)}\n\n`;
  }
  
  return output;
}
