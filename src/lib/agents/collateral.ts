/**
 * Collateral Agent
 *
 * Wraps the existing, pure computeCollateralLtv() (src/lib/builder/
 * collateralLtv.ts) against the real deal_collateral_items table to
 * evaluate collateral coverage against the requested loan amount.
 */

import { Agent } from './base';
import type { AgentName, AgentContext, FindingType, FindingStatus, CollateralFinding } from './types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { computeCollateralLtv } from '@/lib/builder/collateralLtv';
import type { CollateralItem } from '@/lib/builder/builderTypes';

export interface CollateralInput {
  deal_id: string;
  bank_id: string;
  loan_amount?: number;
}

type CollateralSupabaseClient = { from: (table: string) => any };

export class CollateralAgent extends Agent<CollateralInput, CollateralFinding> {
  name: AgentName = 'collateral';
  version = 'v1';
  description = 'Collateral coverage / LTV analysis against SBA policy limits';

  private readonly sb: CollateralSupabaseClient;

  constructor(sb?: CollateralSupabaseClient) {
    super();
    this.sb = sb ?? supabaseAdmin();
  }

  validateInput(input: CollateralInput): { valid: boolean; error?: string } {
    if (!input.deal_id) return { valid: false, error: 'deal_id is required' };
    if (!input.bank_id) return { valid: false, error: 'bank_id is required' };
    return { valid: true };
  }

  async execute(input: CollateralInput, _context: AgentContext): Promise<CollateralFinding> {
    this.log('Running collateral LTV analysis');

    let loanAmount = input.loan_amount;
    if (loanAmount == null) {
      const { data: deal } = await this.sb
        .from('deals')
        .select('loan_amount')
        .eq('id', input.deal_id)
        .maybeSingle();
      loanAmount = (deal as { loan_amount?: number } | null)?.loan_amount ?? 0;
    }

    const { data: itemRows } = await this.sb
      .from('deal_collateral_items')
      .select('*')
      .eq('deal_id', input.deal_id);

    const items = (itemRows ?? []) as CollateralItem[];

    const ltvSummary = computeCollateralLtv(items, loanAmount ?? 0);

    const juniorLienItems = items.filter((i) => (i.lien_position ?? 1) > 1);

    const explanationParts: string[] = [];
    if (items.length === 0) {
      explanationParts.push('No collateral items recorded for this deal yet.');
    } else if (ltvSummary.withinPolicy === false) {
      explanationParts.push(
        `LTV of ${((ltvSummary.ltv ?? 0) * 100).toFixed(1)}% exceeds the ${(
          (ltvSummary.policyLimit ?? 0) * 100
        ).toFixed(0)}% policy limit.`,
      );
    } else if (ltvSummary.withinPolicy === true) {
      explanationParts.push(
        `LTV of ${((ltvSummary.ltv ?? 0) * 100).toFixed(1)}% is within the ${(
          (ltvSummary.policyLimit ?? 0) * 100
        ).toFixed(0)}% policy limit.`,
      );
    }
    if (juniorLienItems.length > 0) {
      explanationParts.push(
        `${juniorLienItems.length} item(s) are in a junior lien position and carry elevated recovery risk.`,
      );
    }

    return {
      collateral_types: items.map((i) => ({
        type: i.item_type,
        description: i.description ?? '',
        estimated_value: i.estimated_value ?? 0,
        lien_position: i.lien_position ?? 1,
      })),
      total_collateral_value: ltvSummary.totalGrossValue,
      loan_amount: loanAmount ?? 0,
      shortfall: ltvSummary.withinPolicy === false,
      shortfall_amount:
        ltvSummary.withinPolicy === false && ltvSummary.ltv != null && ltvSummary.policyLimit != null
          ? Math.max(0, (loanAmount ?? 0) - ltvSummary.totalLendableValue)
          : undefined,
      sop_compliant: ltvSummary.withinPolicy !== false,
      explanation: explanationParts.join(' ') || 'No collateral analysis available.',
    };
  }

  protected getFindingType(_output: CollateralFinding): FindingType {
    return 'requirement';
  }

  protected getFindingStatus(output: CollateralFinding): FindingStatus {
    if (output.collateral_types.length === 0) return 'pending';
    return output.sop_compliant ? 'pass' : 'conditional';
  }

  calculateConfidence(output: CollateralFinding, _input: CollateralInput): number {
    if (output.collateral_types.length === 0) return 0.2;
    return output.sop_compliant ? 0.9 : 0.75;
  }

  requiresHumanReview(output: CollateralFinding): boolean {
    if (output.collateral_types.length === 0) return true;
    if (!output.sop_compliant) return true;
    return output.collateral_types.some((c) => c.lien_position > 1);
  }
}
