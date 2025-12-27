/**
 * API Route: Get Arbitration Status
 * 
 * GET /api/deals/[dealId]/arbitration/status
 * 
 * Returns current arbitration state for a deal.
 */

import { NextRequest } from 'next/server';
import { getCurrentBankId } from '@/lib/tenant/getCurrentBankId';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(
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
    
    const sb = supabaseAdmin();
    
    // Get conflict sets
    const { data: conflictSets } = await sb
      .from('claim_conflict_sets')
      .select('*')
      .eq('deal_id', dealId)
      .eq('bank_id', bankId);
    
    // Get arbitration decisions
    const { data: decisions } = await sb
      .from('arbitration_decisions')
      .select('*')
      .eq('deal_id', dealId)
      .eq('bank_id', bankId);
    
    // Get latest truth snapshot
    const { data: latestSnapshot } = await sb
      .from('deal_truth_snapshots')
      .select('*')
      .eq('deal_id', dealId)
      .eq('bank_id', bankId)
      .order('version', { ascending: false })
      .limit(1)
      .single();
    
    // Get overlay application log
    const { data: overlayLog } = await sb
      .from('overlay_application_log')
      .select('*')
      .eq('deal_id', dealId)
      .order('applied_at', { ascending: false })
      .limit(1)
      .single();
    
    // Calculate stats
    const openConflicts = conflictSets?.filter(cs => cs.status === 'open').length || 0;
    const resolvedConflicts = conflictSets?.filter(cs => cs.status === 'resolved').length || 0;
    const needsHumanConflicts = conflictSets?.filter(cs => cs.status === 'needs_human').length || 0;
    
    const needsHumanDecisions = decisions?.filter(d => d.requires_human_review) || [];
    
    return Response.json({
      ok: true,
      data: {
        conflict_sets: {
          total: conflictSets?.length || 0,
          open: openConflicts,
          resolved: resolvedConflicts,
          needs_human: needsHumanConflicts,
        },
        decisions: {
          total: decisions?.length || 0,
          needs_human_review: needsHumanDecisions.length,
          needs_human_list: needsHumanDecisions,
        },
        latest_truth: latestSnapshot ? {
          version: latestSnapshot.version,
          total_claims: latestSnapshot.total_claims,
          resolved_claims: latestSnapshot.resolved_claims,
          overall_confidence: latestSnapshot.overall_confidence,
          created_at: latestSnapshot.created_at,
        } : null,
        bank_overlay: overlayLog ? {
          overlay_id: overlayLog.overlay_id,
          applied_at: overlayLog.applied_at,
          triggered_rules: overlayLog.triggered_rules,
          added_conditions: overlayLog.added_conditions,
          added_documents: overlayLog.added_documents,
        } : null,
      },
    });
    
  } catch (error) {
    console.error('[Arbitration Status] Error:', error);
    
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
