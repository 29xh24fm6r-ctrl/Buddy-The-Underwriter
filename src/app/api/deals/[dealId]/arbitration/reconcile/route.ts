/**
 * API Route: Reconcile Conflict Sets
 * 
 * POST /api/deals/[dealId]/arbitration/reconcile
 * 
 * Applies arbitration rules R0-R5 to resolve conflicts.
 */

import { NextRequest } from 'next/server';
import { getCurrentBankId } from '@/lib/tenant/getCurrentBankId';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { reconcileAllConflicts, DEFAULT_ARBITRATION_CONFIG } from '@/lib/agents/arbitration';
import { applyBankOverlay } from '@/lib/agents/bank-overlay';
import type { ArbitrationConfig } from '@/lib/agents/arbitration';

interface ReconcileRequest {
  apply_bank_overlay?: boolean;
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
    
    const body = (await req.json()) as ReconcileRequest;
    const sb = supabaseAdmin();
    
    // Load open conflict sets
    const { data: conflictSets, error: conflictsError } = await sb
      .from('claim_conflict_sets')
      .select('*')
      .eq('deal_id', dealId)
      .eq('bank_id', bankId)
      .eq('status', 'open');
    
    if (conflictsError) {
      throw new Error(`Failed to fetch conflict sets: ${conflictsError.message}`);
    }
    
    if (!conflictSets || conflictSets.length === 0) {
      return Response.json({
        ok: true,
        data: {
          decisions_made: 0,
          message: 'No open conflicts to reconcile',
        },
      });
    }
    
    // Load claims for each conflict set
    const claimHashes = conflictSets.map(cs => cs.claim_hash);
    const { data: claims, error: claimsError } = await sb
      .from('agent_claims')
      .select('*')
      .eq('deal_id', dealId)
      .in('claim_hash', claimHashes);
    
    if (claimsError) {
      throw new Error(`Failed to fetch claims: ${claimsError.message}`);
    }
    
    // Build conflict set objects with claims
    const enrichedConflictSets = conflictSets.map(cs => ({
      ...cs,
      claims: claims?.filter(c => c.claim_hash === cs.claim_hash) || [],
    }));
    
    // Load bank overlay if requested
    let config: ArbitrationConfig = DEFAULT_ARBITRATION_CONFIG;
    let overlayApplicationLog: any = null;
    
    if (body.apply_bank_overlay) {
      const { data: activeOverlay } = await sb
        .from('bank_overlays')
        .select('*')
        .eq('bank_id', bankId)
        .eq('is_active', true)
        .single();
      
      if (activeOverlay) {
        const overlayResult = applyBankOverlay(
          activeOverlay.overlay_json,
          claims || [],
          undefined,
          DEFAULT_ARBITRATION_CONFIG
        );
        
        if (overlayResult.adjusted_config) {
          config = overlayResult.adjusted_config;
        }
        
        // Log overlay application
        overlayApplicationLog = {
          deal_id: dealId,
          bank_id: bankId,
          overlay_id: activeOverlay.id,
          overlay_version: activeOverlay.version,
          triggered_rules: overlayResult.triggered_rules,
          added_conditions: overlayResult.added_conditions,
          added_documents: overlayResult.added_documents,
          requires_human_review_flags: overlayResult.requires_human_review_flags,
          adjusted_agent_weights: overlayResult.adjusted_config?.agent_weights || null,
          adjusted_thresholds: overlayResult.adjusted_config?.thresholds || null,
        };
        
        await sb.from('overlay_application_log').insert(overlayApplicationLog);
      }
    }
    
    // Reconcile conflicts
    const decisions = reconcileAllConflicts(enrichedConflictSets, config);
    
    // Insert arbitration decisions
    const decisionRecords = decisions.map(d => ({
      deal_id: dealId,
      bank_id: bankId,
      claim_hash: d.claim_hash,
      chosen_value_json: d.chosen_value_json,
      chosen_claim_id: d.chosen_claim_id,
      decision_status: d.decision_status,
      rationale: d.rationale,
      rule_trace_json: d.rule_trace_json,
      provenance_json: d.provenance_json,
      dissent_json: d.dissent_json,
      requires_human_review: d.requires_human_review,
      created_by: d.created_by,
    }));
    
    const { data: insertedDecisions, error: decisionsError } = await sb
      .from('arbitration_decisions')
      .upsert(decisionRecords, {
        onConflict: 'deal_id,claim_hash',
      })
      .select();
    
    if (decisionsError) {
      throw new Error(`Failed to insert decisions: ${decisionsError.message}`);
    }
    
    // Update conflict set statuses
    for (const decision of decisions) {
      const status = decision.requires_human_review ? 'needs_human' : 'resolved';
      
      await sb
        .from('claim_conflict_sets')
        .update({ status })
        .eq('deal_id', dealId)
        .eq('claim_hash', decision.claim_hash);
    }
    
    // Count results
    const needsHuman = decisions.filter(d => d.requires_human_review).length;
    const resolved = decisions.filter(d => !d.requires_human_review).length;
    
    return Response.json({
      ok: true,
      data: {
        decisions_made: decisions.length,
        auto_resolved: resolved,
        needs_human_review: needsHuman,
        overlay_applied: !!overlayApplicationLog,
        overlay_log: overlayApplicationLog,
      },
    });
    
  } catch (error) {
    console.error('[Arbitration Reconcile] Error:', error);
    
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
