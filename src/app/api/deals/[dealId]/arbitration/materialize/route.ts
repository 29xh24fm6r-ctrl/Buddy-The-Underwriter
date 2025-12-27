/**
 * API Route: Materialize Deal Truth Snapshot
 * 
 * POST /api/deals/[dealId]/arbitration/materialize
 * 
 * Compiles all arbitrated decisions into a single truth_json snapshot.
 */

import { NextRequest } from 'next/server';
import { getCurrentBankId } from '@/lib/tenant/getCurrentBankId';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { materializeTruth } from '@/lib/agents/arbitration';
import { fireDealTruthEvent } from '@/lib/events/deal-truth';

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
    
    const sb = supabaseAdmin();
    
    // Load all arbitration decisions
    const { data: decisions, error: decisionsError } = await sb
      .from('arbitration_decisions')
      .select('*')
      .eq('deal_id', dealId)
      .eq('bank_id', bankId);
    
    if (decisionsError) {
      throw new Error(`Failed to fetch decisions: ${decisionsError.message}`);
    }
    
    if (!decisions || decisions.length === 0) {
      return Response.json({
        ok: true,
        data: {
          truth_snapshot_created: false,
          message: 'No decisions to materialize',
        },
      });
    }
    
    // Materialize truth from decisions
    const truthJson = materializeTruth(decisions);
    
    // Count stats
    const totalClaims = decisions.length;
    const resolvedClaims = decisions.filter(d => d.decision_status === 'chosen').length;
    const needsHuman = decisions.filter(d => d.requires_human_review).length;
    
    // Calculate overall confidence (weighted average)
    const confidences = decisions
      .filter(d => d.rule_trace_json?.final_scores)
      .map(d => {
        const scores = Object.values(d.rule_trace_json.final_scores || {}) as number[];
        return Math.max(...scores, 0);
      });
    
    const overallConfidence = confidences.length > 0
      ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
      : 0;
    
    // Get current version number
    const { data: latestSnapshot } = await sb
      .from('deal_truth_snapshots')
      .select('version')
      .eq('deal_id', dealId)
      .order('version', { ascending: false })
      .limit(1)
      .single();
    
    const nextVersion = (latestSnapshot?.version || 0) + 1;
    
    // Get active bank overlay if any
    const { data: activeOverlay } = await sb
      .from('bank_overlays')
      .select('id, version')
      .eq('bank_id', bankId)
      .eq('is_active', true)
      .single();
    
    // Insert truth snapshot
    const { data: snapshot, error: snapshotError } = await sb
      .from('deal_truth_snapshots')
      .insert({
        deal_id: dealId,
        bank_id: bankId,
        truth_json: truthJson,
        version: nextVersion,
        total_claims: totalClaims,
        resolved_claims: resolvedClaims,
        needs_human: needsHuman,
        overall_confidence: overallConfidence,
        bank_overlay_id: activeOverlay?.id,
        bank_overlay_version: activeOverlay?.version,
        created_by: 'system',
      })
      .select()
      .single();
    
    if (snapshotError) {
      throw new Error(`Failed to create snapshot: ${snapshotError.message}`);
    }
    
    // Fire "deal.truth.updated" event for downstream processing
    const changedTopics = [...new Set(decisions.map(d => d.topic))];
    await fireDealTruthEvent({
      type: 'deal.truth.updated',
      deal_id: dealId,
      bank_id: bankId,
      truth_snapshot_id: snapshot.id,
      trigger: 'agent_run',
      changed_topics: changedTopics,
      timestamp: new Date(),
    });
    
    return Response.json({
      ok: true,
      data: {
        snapshot_id: snapshot.id,
        version: nextVersion,
        total_claims: totalClaims,
        resolved_claims: resolvedClaims,
        needs_human_review: needsHuman,
        overall_confidence: overallConfidence,
        truth: truthJson,
      },
    });
    
  } catch (error) {
    console.error('[Arbitration Materialize] Error:', error);
    
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
