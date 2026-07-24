/**
 * Management Agent
 *
 * Wraps the existing, pure buildManagementPrincipals() (src/lib/creditMemo/
 * management/buildManagementPrincipals.ts) — the same function
 * buildCanonicalCreditMemo.ts already uses — against deal_management_profiles
 * / ownership_entities / deal_borrower_story to assess principal experience
 * and management-related risk.
 */

import { Agent } from './base';
import type { AgentName, AgentContext, FindingType, FindingStatus, ManagementFinding } from './types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildManagementPrincipals } from '@/lib/creditMemo/management/buildManagementPrincipals';
import type {
  ManagementProfile,
  OwnershipEntity,
  PrincipalRow,
} from '@/lib/creditMemo/management/buildManagementPrincipals';

export interface ManagementInput {
  deal_id: string;
  bank_id: string;
}

export interface ManagementOutput {
  principals: ManagementFinding[];
  overall_assessment: string;
}

type ManagementSupabaseClient = { from: (table: string) => any };

const PENDING_BIO_MARKER = 'Pending — complete borrower interview';

export class ManagementAgent extends Agent<ManagementInput, ManagementOutput> {
  name: AgentName = 'management';
  version = 'v1';
  description = 'Management team experience and relevance assessment';

  private readonly sb: ManagementSupabaseClient;

  constructor(sb?: ManagementSupabaseClient) {
    super();
    this.sb = sb ?? supabaseAdmin();
  }

  validateInput(input: ManagementInput): { valid: boolean; error?: string } {
    if (!input.deal_id) return { valid: false, error: 'deal_id is required' };
    if (!input.bank_id) return { valid: false, error: 'bank_id is required' };
    return { valid: true };
  }

  async execute(input: ManagementInput, _context: AgentContext): Promise<ManagementOutput> {
    this.log('Assessing management team');

    const [dealRes, profilesRes, ownersRes, qualFactsRes] = await Promise.all([
      this.sb
        .from('deals')
        .select('borrower_name, display_name, name')
        .eq('id', input.deal_id)
        .maybeSingle(),
      this.sb
        .from('deal_management_profiles')
        .select(
          'person_name, title, ownership_pct, years_experience, industry_experience, prior_business_experience, resume_summary, credit_relevance',
        )
        .eq('deal_id', input.deal_id)
        .eq('bank_id', input.bank_id)
        .limit(20),
      this.sb
        .from('ownership_entities')
        .select('id, display_name, ownership_pct, title, entity_type')
        .eq('deal_id', input.deal_id)
        .limit(10),
      this.sb
        .from('deal_financial_facts')
        .select('fact_key, fact_value_text, fact_value_num')
        .eq('deal_id', input.deal_id)
        .eq('bank_id', input.bank_id)
        .eq('is_superseded', false)
        .eq('fact_type', 'MANAGEMENT')
        .limit(50),
    ]);

    const deal = dealRes.data as { borrower_name?: string | null; display_name?: string | null; name?: string | null } | null;
    const managementProfiles = (profilesRes.data ?? []) as ManagementProfile[];
    const ownerEntities = (ownersRes.data ?? []) as OwnershipEntity[];
    const qualFacts = (qualFactsRes.data ?? []) as { fact_key: string; fact_value_text: string | null; fact_value_num: number | null }[];

    const qualByKey = new Map<string, string>();
    for (const f of qualFacts) {
      const val = f.fact_value_text ?? (f.fact_value_num != null ? String(f.fact_value_num) : null);
      if (val && !qualByKey.has(f.fact_key)) qualByKey.set(f.fact_key, val);
    }

    const { principals } = buildManagementPrincipals({
      managementProfiles,
      ownerEntities,
      overrides: {},
      qualMgmtBackground: qualByKey.get('MANAGEMENT_BACKGROUND') ?? null,
      qualMgmtExpYears: qualByKey.get('MANAGEMENT_EXPERIENCE_YEARS') ?? null,
      borrowerName: deal?.borrower_name ?? null,
      dealDisplayName: deal?.display_name ?? deal?.name ?? null,
    });

    const findings = principals.map((p) => this.toManagementFinding(p));

    const overallAssessment =
      findings.length === 0
        ? 'No management/ownership principals on file for this deal yet.'
        : findings.some((f) => f.concerns.length > 0)
          ? `${findings.filter((f) => f.concerns.length > 0).length} of ${findings.length} principal(s) have incomplete or thin experience documentation.`
          : `All ${findings.length} principal(s) have documented relevant experience.`;

    return { principals: findings, overall_assessment: overallAssessment };
  }

  private toManagementFinding(p: PrincipalRow): ManagementFinding {
    const bioIsPending = p.bio.startsWith(PENDING_BIO_MARKER);
    const yearsExperience = p.years_experience ?? 0;

    const concerns: string[] = [];
    if (bioIsPending) concerns.push('Management bio not yet documented — borrower interview required.');
    if (!bioIsPending && yearsExperience > 0 && yearsExperience < 2) {
      concerns.push('Fewer than 2 years of documented relevant experience.');
    }

    const keyStrengths: string[] = [];
    if (yearsExperience >= 5) keyStrengths.push(`${yearsExperience}+ years of relevant experience.`);
    if (p.prior_roles.length > 0) keyStrengths.push(`Prior roles: ${p.prior_roles.join('; ')}.`);

    const industryMatch = !bioIsPending && (yearsExperience > 0 || p.prior_roles.length > 0);
    const relevanceScore = bioIsPending ? 0 : Math.min(1, yearsExperience / 10);

    return {
      principal_name: p.name,
      years_experience: yearsExperience,
      industry_match: industryMatch,
      relevance_score: relevanceScore,
      key_strengths: keyStrengths,
      concerns,
      narrative_paragraph: p.bio,
    };
  }

  protected getFindingType(_output: ManagementOutput): FindingType {
    return 'requirement';
  }

  protected getFindingStatus(output: ManagementOutput): FindingStatus {
    if (output.principals.length === 0) return 'pending';
    return output.principals.some((p) => p.concerns.length > 0) ? 'conditional' : 'pass';
  }

  calculateConfidence(output: ManagementOutput, _input: ManagementInput): number {
    if (output.principals.length === 0) return 0.2;
    const documented = output.principals.filter((p) => p.relevance_score > 0).length;
    return Math.max(0.4, documented / output.principals.length);
  }

  requiresHumanReview(output: ManagementOutput): boolean {
    return output.principals.length === 0 || output.principals.some((p) => p.concerns.length > 0);
  }
}
