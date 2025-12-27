/**
 * API Route: Ingest Agent Findings into Claims
 * 
 * POST /api/deals/[dealId]/arbitration/ingest
 * 
 * Normalizes agent findings into claims and creates conflict sets.
 */

import { NextRequest } from 'next/server';
import { getCurrentBankId } from '@/lib/tenant/getCurrentBankId';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeAgentFindings } from '@/lib/agents/claim-normalization';
import { groupClaimsIntoConflicts } from '@/lib/agents/arbitration';

interface IngestRequest {
  finding_ids?: string[]; // Specific findings to ingest
  auto_reconcile?: boolean; // Auto-trigger reconciliation
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await context.params;
    const bankId = await getCurrentBankId();
    
    if (!bankId) {
      return Response.json(
        { ok: false, error: 'Bank ID required' },
        { status: 400 }
      );
    }
    
    const body = (await req.json()) as IngestRequest;
    const sb = supabaseAdmin();
    
    // Fetch findings
    let query = sb
      .from('agent_findings')
      .select('*')
      .eq('deal_id', dealId)
      .eq('bank_id', bankId);
    
    if (body.finding_ids && body.finding_ids.length > 0) {
      query = query.in('id', body.finding_ids);
    }
    
    const { data: findings, error: findingsError } = await query;
    
    if (findingsError) {
      throw new Error(`Failed to fetch findings: ${findingsError.message}`);
    }
    
    if (!findings || findings.length === 0) {
      return Response.json({
        ok: true,
        data: {
          claims_created: 0,
          conflict_sets_created: 0,
          message: 'No findings to ingest',
        },
      });
    }
    
    // Normalize findings into claims
    const normalizedClaims = normalizeAgentFindings(findings);
    
    // Insert claims
    const { data: insertedClaims, error: claimsError } = await sb
      .from('agent_claims')
      .insert(normalizedClaims)
      .select();
    
    if (claimsError) {
      throw new Error(`Failed to insert claims: ${claimsError.message}`);
    }
    
    // Group into conflict sets
    const conflictSets = groupClaimsIntoConflicts(normalizedClaims);
    
    // Upsert conflict sets
    const conflictSetRecords = conflictSets.map(set => ({
      deal_id: dealId,
      bank_id: bankId,
      claim_hash: set.claim_hash,
      topic: set.topic,
      predicate: set.predicate,
      timeframe: set.timeframe,
      unit: set.unit,
      num_claims: set.claims.length,
      num_agents: set.num_agents,
      has_blocker: set.has_blocker,
      status: set.claims.length > 1 ? 'open' : 'resolved', // Auto-resolve if single claim
    }));
    
    const { data: insertedConflicts, error: conflictsError } = await sb
      .from('claim_conflict_sets')
      .upsert(conflictSetRecords, {
        onConflict: 'deal_id,claim_hash',
      })
      .select();
    
    if (conflictsError) {
      throw new Error(`Failed to upsert conflict sets: ${conflictsError.message}`);
    }
    
    return Response.json({
      ok: true,
      data: {
        claims_created: insertedClaims?.length || 0,
        conflict_sets_created: insertedConflicts?.length || 0,
        conflict_sets: conflictSets,
      },
    });
    
  } catch (error) {
    console.error('[Arbitration Ingest] Error:', error);
    
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
