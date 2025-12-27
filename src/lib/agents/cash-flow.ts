/**
 * Cash Flow Agent: Debt Service God
 * 
 * Calculates DSCR (Debt Service Coverage Ratio) without Excel hell.
 * Normalizes tax returns, adjusts add-backs, explains every adjustment in plain English.
 */

import { Agent } from './base';
import type {
  AgentName,
  AgentContext,
  FindingType,
  FindingStatus,
  CashFlowFinding,
} from './types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { aiJson } from '@/lib/ai/openai';

interface CashFlowInput {
  deal_id: string;
  bank_id: string;
  credit_context?: any[]; // From Credit Agent
}

interface CashFlowOutput {
  years: CashFlowFinding[];
  global_dscr: number;
  pass: boolean;
  summary: string;
  requires_explanation: boolean;
}

export class CashFlowAgent extends Agent<CashFlowInput, CashFlowOutput> {
  name: AgentName = 'cash_flow';
  version = 'v1';
  description = 'DSCR calculator with intelligent add-back analysis';
  
  private readonly MIN_DSCR = 1.25; // SBA standard minimum
  
  validateInput(input: CashFlowInput): { valid: boolean; error?: string } {
    if (!input.deal_id) {
      return { valid: false, error: 'deal_id is required' };
    }
    if (!input.bank_id) {
      return { valid: false, error: 'bank_id is required' };
    }
    return { valid: true };
  }
  
  async execute(
    input: CashFlowInput,
    context: AgentContext
  ): Promise<CashFlowOutput> {
    this.log('Calculating cash flow and DSCR');
    
    // Get deal and financial data
    const deal = await this.getDealData(input.deal_id, input.bank_id);
    const financials = await this.getFinancialData(input.deal_id);
    
    if (financials.length === 0) {
      this.warn('No financial data found - cannot calculate DSCR');
      return {
        years: [],
        global_dscr: 0,
        pass: false,
        summary: 'No financial data available for DSCR calculation',
        requires_explanation: true,
      };
    }
    
    // Calculate DSCR for each year
    const years: CashFlowFinding[] = [];
    
    for (const year of financials) {
      const finding = await this.calculateYearDSCR(year, deal);
      years.push(finding);
    }
    
    // Calculate global DSCR (weighted average of recent years)
    const globalDSCR = this.calculateGlobalDSCR(years);
    
    // Overall pass/fail
    const pass = globalDSCR >= this.MIN_DSCR;
    
    const summary = pass
      ? `Global DSCR of ${globalDSCR.toFixed(2)}x meets minimum requirement of ${this.MIN_DSCR}x`
      : `Global DSCR of ${globalDSCR.toFixed(2)}x is below minimum requirement of ${this.MIN_DSCR}x`;
    
    this.log(summary);
    
    return {
      years,
      global_dscr: globalDSCR,
      pass,
      summary,
      requires_explanation: !pass || globalDSCR < 1.35, // Flag if marginal
    };
  }
  
  /**
   * Calculate DSCR for a single year
   */
  private async calculateYearDSCR(
    yearData: any,
    deal: any
  ): Promise<CashFlowFinding> {
    const year = yearData.year;
    const netIncome = yearData.net_income || 0;
    
    // Standard add-backs
    const adjustments = [];
    
    // 1. Depreciation & Amortization (non-cash expense)
    if (yearData.depreciation) {
      adjustments.push({
        label: 'Depreciation & Amortization',
        amount: yearData.depreciation,
        justification: 'Non-cash expense - added back to cash flow',
      });
    }
    
    // 2. Interest Expense (will be replaced with new loan interest)
    if (yearData.interest_expense) {
      adjustments.push({
        label: 'Interest Expense',
        amount: yearData.interest_expense,
        justification: 'Existing interest replaced with new loan debt service',
      });
    }
    
    // 3. Owner Compensation (if excessive)
    if (yearData.officer_compensation) {
      const marketRate = 150_000; // Reasonable market comp (simplified)
      const excess = Math.max(0, yearData.officer_compensation - marketRate);
      
      if (excess > 0) {
        adjustments.push({
          label: 'Excess Owner Compensation',
          amount: excess,
          justification: `Officer comp of $${yearData.officer_compensation.toLocaleString()} exceeds market rate of $${marketRate.toLocaleString()}`,
        });
      }
    }
    
    // 4. One-time expenses
    if (yearData.one_time_expenses) {
      adjustments.push({
        label: 'One-Time Expenses',
        amount: yearData.one_time_expenses,
        justification: 'Non-recurring expenses (legal, moving, etc.)',
      });
    }
    
    // Calculate adjusted cash flow
    const totalAdjustments = adjustments.reduce((sum, adj) => sum + adj.amount, 0);
    const adjustedCashFlow = netIncome + totalAdjustments;
    
    // Calculate debt service
    const loanAmount = deal.loan_amount || 0;
    const interestRate = deal.interest_rate || 0.08; // 8% default
    const termYears = deal.term_years || 10;
    
    const monthlyRate = interestRate / 12;
    const numPayments = termYears * 12;
    const monthlyPayment = loanAmount > 0
      ? (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
        (Math.pow(1 + monthlyRate, numPayments) - 1)
      : 0;
    
    const annualDebtService = monthlyPayment * 12;
    
    // Calculate DSCR
    const dscr = annualDebtService > 0 ? adjustedCashFlow / annualDebtService : 0;
    
    const pass = dscr >= this.MIN_DSCR;
    
    const explanation = `Year ${year}: Net income $${netIncome.toLocaleString()} + adjustments $${totalAdjustments.toLocaleString()} = $${adjustedCashFlow.toLocaleString()} cash flow. ` +
      `Annual debt service $${annualDebtService.toLocaleString()} = ${dscr.toFixed(2)}x DSCR. ` +
      (pass ? 'Meets minimum requirement.' : 'Below minimum requirement.');
    
    return {
      year,
      net_income: netIncome,
      adjustments,
      adjusted_cash_flow: adjustedCashFlow,
      debt_service: annualDebtService,
      dscr,
      pass,
      explanation,
    };
  }
  
  /**
   * Calculate global DSCR (weighted average)
   */
  private calculateGlobalDSCR(years: CashFlowFinding[]): number {
    if (years.length === 0) return 0;
    
    // Weight recent years more heavily
    const weights = [1.0, 1.5, 2.0]; // Oldest to newest
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    years.forEach((year, idx) => {
      const weight = weights[Math.min(idx, weights.length - 1)] || 1.0;
      weightedSum += year.dscr * weight;
      totalWeight += weight;
    });
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }
  
  /**
   * Get deal data
   */
  private async getDealData(deal_id: string, bank_id: string): Promise<any> {
    const sb = supabaseAdmin();
    
    const { data, error } = await sb
      .from('deals')
      .select('*')
      .eq('id', deal_id)
      .eq('bank_id', bank_id)
      .single();
    
    if (error) {
      throw new Error(`Failed to fetch deal: ${error.message}`);
    }
    
    return data;
  }
  
  /**
   * Get financial data (tax returns, financials)
   */
  private async getFinancialData(deal_id: string): Promise<any[]> {
    // In real implementation, would parse uploaded tax returns
    // For now, return mock data structure
    
    // TODO: Query borrower_files for tax returns
    // TODO: Extract financial data from OCR results
    
    return [
      {
        year: 2022,
        net_income: 250_000,
        depreciation: 50_000,
        interest_expense: 30_000,
        officer_compensation: 200_000,
      },
      {
        year: 2023,
        net_income: 280_000,
        depreciation: 55_000,
        interest_expense: 28_000,
        officer_compensation: 210_000,
      },
      {
        year: 2024,
        net_income: 310_000,
        depreciation: 60_000,
        interest_expense: 25_000,
        officer_compensation: 220_000,
      },
    ];
  }
  
  protected getFindingType(output: CashFlowOutput): FindingType {
    return 'requirement';
  }
  
  protected getFindingStatus(output: CashFlowOutput): FindingStatus {
    if (output.pass) return 'pass';
    return output.global_dscr > 1.0 ? 'conditional' : 'fail';
  }
  
  calculateConfidence(output: CashFlowOutput, input: CashFlowInput): number {
    if (output.years.length === 0) return 0.3; // Low confidence without data
    
    // High confidence if we have 3+ years of data
    if (output.years.length >= 3) return 0.95;
    if (output.years.length === 2) return 0.85;
    return 0.70;
  }
  
  requiresHumanReview(output: CashFlowOutput): boolean {
    // Require review if failed or marginal
    return !output.pass || output.global_dscr < 1.35 || output.requires_explanation;
  }
}
