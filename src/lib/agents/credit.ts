/**
 * Credit Agent
 *
 * Evaluates each owner/guarantor's personal credit standing against the
 * real (previously unqueried) credit-screening schema: borrower_credit_pulls
 * (FICO + summary counts), borrower_credit_tradelines (delinquency detail),
 * borrower_caivrs_checks, borrower_sam_exclusions — see migrations
 * 20260520_a_borrower_credit_pulls.sql / 20260520_b_borrower_caivrs_sam.sql.
 */

import { Agent } from './base';
import type { AgentName, AgentContext, FindingType, FindingStatus, CreditFinding, CreditCheckItem } from './types';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface CreditInput {
  deal_id: string;
  bank_id: string;
}

type CreditSupabaseClient = { from: (table: string) => any };

interface CreditPullRow {
  id: string;
  ownership_entity_id: string | null;
  status: string;
  fico_score: number | null;
  delinquencies_count: number | null;
  public_records_count: number | null;
}

interface TradelineRow {
  id: string;
  account_type: string | null;
  creditor_name: string | null;
  open_date: string | null;
  current_balance: number | null;
  is_delinquent: boolean | null;
  is_charged_off: boolean | null;
  is_in_collection: boolean | null;
}

interface CaivrsRow {
  id: string;
  ownership_entity_id: string | null;
  status: string;
  hit_count: number | null;
}

interface SamExclusionRow {
  id: string;
  ownership_entity_id: string | null;
  status: string;
  hit_count: number | null;
}

export class CreditAgent extends Agent<CreditInput, CreditFinding> {
  name: AgentName = 'credit';
  version = 'v1';
  description = 'Personal credit, CAIVRS, and SAM exclusion screening for all owners/guarantors';

  private readonly sb: CreditSupabaseClient;

  constructor(sb?: CreditSupabaseClient) {
    super();
    this.sb = sb ?? supabaseAdmin();
  }

  validateInput(input: CreditInput): { valid: boolean; error?: string } {
    if (!input.deal_id) return { valid: false, error: 'deal_id is required' };
    if (!input.bank_id) return { valid: false, error: 'bank_id is required' };
    return { valid: true };
  }

  async execute(input: CreditInput, _context: AgentContext): Promise<CreditFinding> {
    this.log('Running credit screening');

    const [pullsRes, tradelinesRes, caivrsRes, samRes, ownersRes] = await Promise.all([
      this.sb.from('borrower_credit_pulls').select('*').eq('deal_id', input.deal_id),
      this.sb.from('borrower_credit_tradelines').select('*').eq('deal_id', input.deal_id),
      this.sb.from('borrower_caivrs_checks').select('*').eq('deal_id', input.deal_id),
      this.sb.from('borrower_sam_exclusions').select('*').eq('deal_id', input.deal_id),
      this.sb.from('ownership_entities').select('id, display_name').eq('deal_id', input.deal_id),
    ]);

    const pulls = (pullsRes.data ?? []) as CreditPullRow[];
    const tradelines = (tradelinesRes.data ?? []) as TradelineRow[];
    const caivrsChecks = (caivrsRes.data ?? []) as CaivrsRow[];
    const samExclusions = (samRes.data ?? []) as SamExclusionRow[];
    const owners = (ownersRes.data ?? []) as { id: string; display_name: string | null }[];

    const ownerName = (ownershipEntityId: string | null): string | undefined =>
      owners.find((o) => o.id === ownershipEntityId)?.display_name ?? undefined;

    const checks: CreditCheckItem[] = [];

    for (const pull of pulls.filter((p) => p.status === 'completed')) {
      checks.push(this.buildFicoCheck(pull, ownerName(pull.ownership_entity_id)));
    }

    for (const tl of tradelines.filter((t) => t.is_delinquent || t.is_charged_off || t.is_in_collection)) {
      checks.push(this.buildTradelineCheck(tl));
    }

    for (const check of caivrsChecks.filter((c) => c.status === 'hit')) {
      checks.push(this.buildCaivrsCheck(check, ownerName(check.ownership_entity_id)));
    }

    for (const exclusion of samExclusions.filter((s) => s.status === 'hit')) {
      checks.push(this.buildSamExclusionCheck(exclusion, ownerName(exclusion.ownership_entity_id)));
    }

    const hasFatal = checks.some((c) => c.check_name === 'caivrs' || c.check_name === 'sam_exclusion');
    const hasMitigable = checks.some((c) => !c.passed && !hasFatal);
    const sbaImpact: CreditFinding['sba_impact'] = hasFatal ? 'fatal' : hasMitigable ? 'mitigable' : 'none';

    const mitigationOptions = Array.from(
      new Set(
        checks
          .filter((c) => !c.passed)
          .map((c) => this.mitigationFor(c))
          .filter((m): m is string => Boolean(m)),
      ),
    );

    const overallPass = sbaImpact === 'none';

    const summary = overallPass
      ? pulls.length > 0
        ? `Credit screening complete for ${pulls.length} pull(s); no derogatory findings.`
        : 'No credit pulls on file yet for this deal.'
      : `Credit screening found ${checks.filter((c) => !c.passed).length} issue(s) requiring review.`;

    this.log(`Credit screening complete. sba_impact=${sbaImpact}`);

    return {
      checks,
      sba_impact: sbaImpact,
      mitigation_options: mitigationOptions,
      summary,
      overall_pass: overallPass,
    };
  }

  private buildFicoCheck(pull: CreditPullRow, borrowerName?: string): CreditCheckItem {
    const score = pull.fico_score ?? null;
    const passed = score != null && score >= 640;
    return {
      check_name: 'fico_score',
      passed,
      borrower_id: pull.ownership_entity_id ?? undefined,
      borrower_name: borrowerName,
      credit_score: score ?? undefined,
      derogatories: [],
      detail:
        score == null
          ? 'FICO score not yet available for this pull.'
          : passed
            ? `FICO ${score} meets SBA credit-standard threshold.`
            : `FICO ${score} is below the 640 threshold typically required for SBA credit standards.`,
      sop_citation: 'SOP 50 10 8 §B — Credit Standards',
    };
  }

  private buildTradelineCheck(tl: TradelineRow): CreditCheckItem {
    const status = tl.is_charged_off ? 'charged_off' : tl.is_in_collection ? 'in_collection' : 'delinquent';
    return {
      check_name: 'tradeline_delinquency',
      passed: false,
      derogatories: [
        {
          type: tl.account_type ?? 'unknown',
          date: tl.open_date ?? undefined,
          amount: tl.current_balance ?? undefined,
          status,
          explanation: tl.creditor_name ? `${tl.creditor_name} tradeline flagged as ${status}` : undefined,
        },
      ],
      detail: `Tradeline (${tl.account_type ?? 'unknown type'}) flagged as ${status}.`,
      sop_citation: 'SOP 50 10 8 §B — Credit Standards',
    };
  }

  private buildCaivrsCheck(check: CaivrsRow, borrowerName?: string): CreditCheckItem {
    return {
      check_name: 'caivrs',
      passed: false,
      borrower_id: check.ownership_entity_id ?? undefined,
      borrower_name: borrowerName,
      derogatories: [
        {
          type: 'federal_debt_delinquency',
          status: 'open',
          explanation: `CAIVRS returned ${check.hit_count ?? 1} hit(s) indicating delinquent federal debt.`,
        },
      ],
      detail: 'CAIVRS hit — borrower has a delinquent federal debt or prior SBA loss on record.',
      sop_citation: 'SOP 50 10 8 §A Ch.5 — CAIVRS',
    };
  }

  private buildSamExclusionCheck(exclusion: SamExclusionRow, borrowerName?: string): CreditCheckItem {
    return {
      check_name: 'sam_exclusion',
      passed: false,
      borrower_id: exclusion.ownership_entity_id ?? undefined,
      borrower_name: borrowerName,
      derogatories: [
        {
          type: 'federal_exclusion',
          status: 'open',
          explanation: `SAM.gov returned ${exclusion.hit_count ?? 1} exclusion hit(s).`,
        },
      ],
      detail: 'SAM.gov exclusion hit — borrower/principal is debarred or suspended from federal programs.',
      sop_citation: 'SOP 50 10 8 §A — Debarment and Suspension',
    };
  }

  private mitigationFor(check: CreditCheckItem): string | null {
    switch (check.check_name) {
      case 'fico_score':
        return 'Obtain a written credit explanation letter and consider a co-signer or additional collateral.';
      case 'tradeline_delinquency':
        return 'Obtain a credit explanation letter addressing the delinquent/charged-off tradeline.';
      case 'caivrs':
      case 'sam_exclusion':
        return null; // fatal — no standard mitigation short of a documented exception.
      default:
        return null;
    }
  }

  protected getFindingType(_output: CreditFinding): FindingType {
    return 'requirement';
  }

  protected getFindingStatus(output: CreditFinding): FindingStatus {
    if (output.sba_impact === 'fatal') return 'fail';
    if (output.sba_impact === 'mitigable') return 'conditional';
    return 'pass';
  }

  calculateConfidence(output: CreditFinding, _input: CreditInput): number {
    if (output.checks.length === 0) return 0.2; // no pulls/screens on file yet
    if (output.sba_impact === 'fatal') return 0.9;
    if (output.sba_impact === 'mitigable') return 0.7;
    return 0.9;
  }

  requiresHumanReview(output: CreditFinding): boolean {
    return output.sba_impact !== 'none';
  }
}
